"""Focused evidence, feature-contract, posterior, and storm-holdout checks."""
import copy
import importlib.util
import os
from pathlib import Path
import unittest

import numpy as np
from scipy.special import expit

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('fit_fragility', HERE/'fit_fragility.py')
fit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fit)
ARTIFACT_ROOT = Path(os.environ.get('FRAGILITY_ARTIFACT_ROOT', HERE.parents[1]))
ENGINE_ROOT = Path(os.environ.get('FRAGILITY_ENGINE_ROOT', ARTIFACT_ROOT))


class FragilityEvidenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cohort = fit.read(ARTIFACT_ROOT/'data/curated/fragility_cohort.json')
        cls.hazards = fit.read(ARTIFACT_ROOT/'data/curated/fragility_hazards.json')
        cls.model = fit.read(ARTIFACT_ROOT/'web/public/data/model/fragility_model.json')
        cls.rows, cls.excluded = fit.training_rows(cls.cohort, cls.hazards)

    def test_only_verified_outcomes_enter_likelihood(self):
        self.assertEqual((len(self.rows), sum(r['disrupted'] for r in self.rows)), (6, 4))
        self.assertEqual(len(self.excluded), 3)
        self.assertEqual({r['status'] for r in self.rows if not r['disrupted']},
                         {'confirmed_operating', 'confirmed_planned_restart'})
        for row in self.excluded:
            self.assertTrue(row['exclusionReason'])
        for source in self.cohort['sources']:
            self.assertTrue(source['primary'])
            self.assertTrue(source['url'].startswith('https://'))
            self.assertLessEqual(len(source['quote'].split()), 25)
        amgen = next(r for r in self.rows if r['plantId'] == 'amgen-juncos-pr')
        self.assertTrue(amgen['disrupted'])

    def test_reject_duplicate_synthetic_or_unsourced_labels(self):
        duplicate = copy.deepcopy(self.cohort)
        duplicate['observations'].append(duplicate['observations'][0])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            fit.training_rows(duplicate, self.hazards)
        for key, value in [('sourceIds', []), ('labelOrigin', 'synthetic')]:
            cohort = copy.deepcopy(self.cohort)
            cohort['observations'][0][key] = value
            with self.assertRaises(ValueError):
                fit.training_rows(cohort, self.hazards)

    def test_raw_features_and_missingness(self):
        for row in self.rows:
            h = row['hazards']
            x = row['x']
            self.assertEqual(x[0], 1)
            self.assertAlmostEqual(x[1], max(0, h['windKt']-50)/50)
            self.assertAlmostEqual(x[2], np.log1p(h['effectiveRainIn']/4))
            self.assertAlmostEqual(x[3], x[2]*np.exp(-h['riverDistKm']/1.5))
            self.assertEqual(x[4], x[2] if h['sfha'] else 0)
            self.assertEqual(x[5], h['tornadoProbability'])
            self.assertIn('geometry=', h['inputProvenance']['river'])
            self.assertIn('geometry=', h['inputProvenance']['flood'])
        bad = dict(self.rows[0]['hazards'], windKt=float('nan'))
        with self.assertRaises(ValueError):
            fit.features(bad)
        empty_flood = {'lon': 0, 'lat': 0, 'river': {'response': {'features': []}},
                       'flood': {'response': {'features': []}}}
        with self.assertRaisesRegex(ValueError, 'No mapped FEMA'):
            fit.geography({'lon': 0, 'lat': 0}, empty_flood)

    def test_posterior_is_updated_and_worker_compatible(self):
        samples = np.array(self.model['samples'])
        self.assertEqual(self.model['featureOrder'], fit.ORDER)
        self.assertEqual(samples.shape, (4096, 6))
        self.assertTrue(np.isfinite(samples).all())
        self.assertFalse(self.model['operationallyCalibrated'])
        mu, _ = fit.priors(ENGINE_ROOT)
        self.assertGreater(np.linalg.norm(samples.mean(axis=0)-mu), .1)
        diagnostic = self.model['training']['diagnostics']
        self.assertLess(diagnostic['maxRhat'], 1.05)
        self.assertGreater(diagnostic['minESS'], 200)

    def test_holdouts_are_whole_storms_and_predictions_use_training_only(self):
        validation = self.model['validation']
        by_id = {r['id']: r for r in self.rows}
        seen = set()
        for fold in validation['folds']:
            self.assertFalse(set(fold['trainIds']) & set(fold['testIds']))
            self.assertTrue(all(by_id[k]['eventId'] != fold['heldOutEvent'] for k in fold['trainIds']))
            self.assertTrue(all(by_id[k]['eventId'] == fold['heldOutEvent'] for k in fold['testIds']))
            seen.update(fold['testIds'])
        self.assertEqual(seen, set(by_id))
        # Independent refit of the first fold cannot access its test outcomes.
        fold = validation['folds'][0]
        train = [by_id[k] for k in fold['trainIds']]
        test = [by_id[k] for k in fold['testIds']]
        mu, sd = fit.priors(ENGINE_ROOT)
        chains = fit.sample_posterior(np.array([r['x'] for r in train]),
                                     np.array([r['disrupted'] for r in train], float), mu, sd,
                                     seed=fit.SEED+100, draws=1024)
        predicted = expit(np.array([r['x'] for r in test]) @ chains.reshape(-1, 6).T).mean(axis=1)
        saved = {r['id']: r['predicted'] for r in validation['predictions']}
        np.testing.assert_allclose(predicted, [saved[r['id']] for r in test], atol=1e-12)
        self.assertEqual(sum(b['n'] for b in validation['calibrationBins']), len(self.rows))

    def test_archived_queries_and_engine_reproduce_covariates(self):
        cache = fit.read(ARTIFACT_ROOT/'data/curated/fragility_site_inputs.json')
        rebuilt = fit.compute_hazards(ENGINE_ROOT, self.cohort, cache)
        self.assertEqual(rebuilt['rows'], self.hazards['rows'])


if __name__ == '__main__':
    unittest.main()
