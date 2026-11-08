# Judge Q&A

1. **Are these real hospital inventories?**  
   Hospital locations and archived facility attributes come from public records. Inventory, utilization, contracts and shipment relationships are scenario assumptions. Each prediction links to its provenance.

2. **Did you predict Helene before it happened?**  
   This is a retrospective counterfactual. Weather products become available at their issue timestamps. The displayed trigger is September 25, 2024 at 19:31 UTC, about 32.5 hours before the conservative flood-day reference.

3. **How do you know the exact plant failure time?**  
   The flood date is documented. The hour is unpublished. We use local midnight at the beginning of that date to report a conservative lead-time reference and expose this choice in the backtest.

4. **How accurate is the ML model?**  
   The FDA-posting benchmark has held-out ROC AUC 0.414 and PR AUC 0.146, with a 0.139 positive rate. Its weak discrimination and incomplete target history are visible in the model card. Prospective reliability is unproven.

5. **Could the early warning cause hoarding?**  
   That is the behavior the market simulation demonstrates. The proposed workflow sends the same warning simultaneously and caps fair-policy orders at modeled unmet need. Deployment would require shared distributor participation.

6. **Who decides what is fair?**  
   The objective and constraints are inspectable. Vulnerability, rurality, safety-net status and pediatric demand affect coverage floors and weights. A slider exposes the trade-off, and operational governance would set the policy.

7. **Does the system ration care between patients?**  
   Its scope is aggregate hospital supply planning. Patient-specific triage requires clinician-led review and an established clinical allocation framework. The copilot directs those questions to that framework.

8. **How do you establish a drug-to-plant link?**  
   Public manufacturer reports support the key case-study links. Label and registration matches provide candidates with confidence and evidence. Representative or unresolved mappings carry explicit provenance. Labeler names alone cannot prove production location.

9. **Why do you have more than 6,000 hospitals?**  
   The archived HIFLD snapshot contains 7,105 facilities, including specialty hospitals. Its historical vintage, proxies and missing fields are documented. It is a planning sample with a broader definition than an acute-care hospital count.

10. **What happens if the network fails during the demo?**  
    Replay data, map geometry, fonts and imagery are bundled locally. Browser workers compute the storm ensemble and allocation. The copilot supplies cached analyses derived from the active scenario and executes the same UI commands.

11. **Does it work for tornadoes?**  
    The Rocky Mount replay demonstrates a hard failure case. Broad SPC probabilities provide insufficient evidence for a reliable factory-specific early alert. The recorded damage and resulting supply scenario can still be explored.

12. **How do you measure carbon savings?**  
    We compare assumed planned ground freight with emergency air freight and include a waste proxy. Each counter exposes shipment mass, distance, mode factors and scope. These are model estimates awaiting logistics validation.

13. **Who pays for the product?**  
    The intended user is a hospital pharmacy or regional supply team. Hospital systems, distributors and group purchasing organizations are possible pilot partners. Pricing and willingness to pay remain hypotheses.

14. **What is required before a hospital uses it operationally?**  
    Verified supplier relationships, current inventory integration, prospective alert testing, calibrated uncertainty, independent fairness review and authenticated human approvals. Clinical and purchasing decisions require local governance.

15. **What can a judge inspect or change right now?**  
    Scrub a dated weather replay, select a hospital, approve a reviewed action, export a briefing, compare policies, change the equity weight, draw a storm and ask the copilot to move the map. The Sources and Model card pages expose the supporting evidence and limitations.
