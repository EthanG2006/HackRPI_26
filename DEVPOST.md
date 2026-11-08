# Rx Radar

## Inspiration

A storm can shut down a drug factory. If hospitals depend on that factory, they can lose supply even if the storm never reaches them. So we wanted to follow the storm all the way to the hospitals it could affect.

## What it does

We start with a disaster and find which factories and distribution hubs are exposed. Then we estimate which medicines could run short and which hospitals run out first. We also compare allocation policies and possible reroutes, so a pharmacy team can review what to do next.

## How we built it

We use React and TypeScript for the interface, with MapLibre and deck.gl for the map. Python handles the data and modeling. The simulations also run in browser workers, so the cached scenarios work without internet.

## Challenges

Here we need to separate what is known from what is assumed. Public records don't give us each hospital's inventory or each factory's capacity, so we can't treat every estimate as a measured result.

## Accomplishments

We can follow a storm forecast to a hospital plan in Troy. The same map also lets us compare fair allocation, test another disaster, and see how rerouting changes the available supply.

## What we learned

A shortage estimate by itself doesn't tell a hospital what to do, it needs actionable results that it can utilize to mitigate the disaster. We learned about the ways we can apply our ML and data science skills to real-world problems, where the goal is to turn predictions into decisions that people can actually use.

## What's next

Next we need actual inventory and purchasing data from hospitals and distributors. This would let us compare the predictions with what happens and improve the estimates.

## Prize tracks

**Healthcare:** We connect weather exposure to medicine availability, so pharmacy teams can prepare earlier.

**Sustainability:** We compare planned shipments with emergency delivery to estimate avoidable freight emissions and waste.

**Ethical AI:** We compare allocation rules under the same supply budget. Purchasing power therefore doesn't have to determine who gets supplied.

**ML / Data Science:** We combine spatial data, shortage modeling, storm simulations and optimization, with uncertainty shown alongside the results.
