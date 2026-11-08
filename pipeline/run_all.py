"""Rebuild all numerical outputs offline. Pass --refresh to refresh public reference snapshots."""
import argparse
from .common import PUBLIC, read, save
from .catalog import make_catalog, network
from .risk import train
from .scenarios import build as scenarios, apply_impacts
from .sources import build as sources


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--refresh',action='store_true')
    args=parser.parse_args()
    if args.refresh:
        from .fetch_catalog import geography,shortages
        from .fetch_weather import hurricane,tornado
        geography()
        shortages()
        hurricane('helene','AL092024',18)
        hurricane('maria','AL152017',25)
        tornado()
    drugs,plants=make_catalog()
    from .entity_resolution import resolve
    resolve(plants)
    train(drugs)
    save(PUBLIC/'drugs.json',drugs)
    save(PUBLIC/'plants.json',plants)
    hospitals=read(PUBLIC/'hospitals.json')['hospitals']
    network(drugs,plants,hospitals)
    scenarios(drugs,plants,hospitals)
    from server.equity.engine import build_all
    build_all()
    apply_impacts()
    sources()
    print('Offline data bundle built successfully.')


if __name__=='__main__':
    main()
