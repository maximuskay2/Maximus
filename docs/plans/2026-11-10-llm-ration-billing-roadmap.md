# LLM ration billing roadmap

Who builds this is in [2026-11-10-team-execution-roadmap.md](2026-11-10-team-execution-roadmap.md). Tosin owns this spec.

Date: 2026-11-10. Prices below were read from public pages on that day. Recheck them before an admin saves a catalog. This is a plan, not a live price list.

## Status

The harness now saves the rate profile, the wallet, the pooled Muse key, and the admin Rates page. A Muse gateway turn is preflighted and debited. A paid invoice resets the wallet once. Pricing reads those four plans on startup. Usage, on desktop and phone, shows cents left and the Spark equivalent. Contributor Spark stays locked until the person accepts it. One verified email and one install id get one free grant. Bring-your-own turns do not debit, and they stop at the hour and day caps. Image generation is refused before the provider when the plan cannot pay `$0.01`. A finished Muse web search debits `$0.0025` on a hosted plan. When overage is on, the margin report prices those models at the multiplier, and the wallet stops at the included cost times the second-stop multiplier (Starter at $16). The wallet itself still debits provider cost. Pricing lists the one-time free grant beside Your model and the three hosted prices.

Stripe and Paystack price ids stay in `MAXIMUS_STRIPE_PRICES` and `MAXIMUS_PAYSTACK_PLANS`. App Store and Play product ids stay in those stores. The phone shows the store price from the rate profile and still unlocks whatever product the store already sells.

## What this changes

People get a small free Muse Code grant, then pick one of two paid ways to keep going:

- **Your model.** They bring an LLM key. They pay Meta (or whoever issued the key). They pay us a lower monthly fee for the app on web, desktop, and phone.
- **Maximus model.** They pay us more. Turns run on the API key the admin stored, and each turn spends a ration of that key.

The wallet is one number per workspace: **cents of Muse Spark we pay the provider**. The screen also shows that balance as Spark tokens. Input, cached input, and output all spend the same wallet, because a single token count would ignore that output costs more than input.

## How the repo bills today

Keep these. The new wallet sits on them.

| Piece | Where | What it does |
| --- | --- | --- |
| Usage ledger | `server/usage-ledger.ts` | One row per turn. `via: "bundled"` spends our key. `via: "byo"` spends the user's key and is not billed. |
| Gateway | `server/billing/gateway.ts` | The only place our provider keys are attached. Env names include `MAXIMUS_GATEWAY_META_KEY`. |
| Plans | `server/billing/plans.ts`, `server/billing/plan-store.ts` | `baseUsd`, `allowanceUsd`, `hardCapUsd`. Admin saves them to `<datadir>/billing/plans.json` through `/api/admin/plans`. Seed is `MAXIMUS_BILLING_PLANS`. |
| Allowance | `server/billing/allowance.ts` | Bundled rows burn the allowance. Past `hardCapUsd` the turn returns `spend_cap` 409. |
| Checkout | `server/billing/checkout.ts`, `server/billing/events.ts`, `server/billing/dunning.ts` | Stripe or Paystack. A paid invoice activates the workspace. Failure goes grace, then suspended. |
| Sell prices | `server/prices.ts`, config `billing.prices` | Our price per million tokens. Unpriced rows add nothing. |
| Vendor rates | `server/model-prices.ts` | List rates for other vendors. Muse is not in this table yet. |
| Margin | `GET /api/admin/usage/margin` | Bundled provider cost against what we charged. A negative margin blocks a public price. |
| Trial credit | `server/cloud-credit-provider.ts` | A Cloud-home Claude relay. Separate from this grant. Leave it for existing Cloud homes. |
| Phone plans | `server/billing/store.ts`, `mobile/lib/billing/` | App Store and Play unlock a plan. They do not meter tokens. |

Admin → Keys today stores keys for that server's own bots. The pooled key users draw down is still an environment variable. Worker `PLAN_CATALOG` does not follow Admin → Plans. Fix that in the same release as hosted plans, or hosted workspaces will keep the old allowances.

## What the ration has to earn

We pay Meta's list price for every bundled token. Muse Code's own $5 / $15 / $50 / $200 plans are first-party: Meta does not pay that list price to itself. Matching those headlines loses money. Price against the API invoice, then charge for the app on top.

Profit on one workspace in a month:

```text
profit = fee we keep
       − Muse cost of tokens they actually used
       − card or store fee
       − hosting for that workspace
```

Three levers, in the order they protect the invoice:

1. **A hard cap equal to the included provider cost.** A looping bot stops. Overage is off until the admin turns it on, and even then a second cap sits at twice the included cost.
2. **Breakage.** People who pay and use only part of the ration are the margin. The cap is what makes the unused part real. If the cap is missing, the heaviest accounts wipe the light ones.
3. **A bring-your-own seat with no model cost.** That fee is almost all margin. It must stay cheaper than hosted, and the gap must be wide enough that a heavy user would rather bring a key than burn our cap.

Payment cuts used in the tables:

- Web, Stripe domestic cards: 2.9% + $0.30 per charge ([stripe.com/pricing](https://stripe.com/pricing)). Stripe Billing can add 0.7% on renewals. The tables use the card fee only.
- App Store Small Business Program: 15% under $1M prior-year proceeds, otherwise 30%, and 15% after a subscriber's first year ([Apple](https://developer.apple.com/app-store/small-business-program/)).
- Google Play: 15% on the first $1M of earnings.

Hosting is planned at about $1 per active workspace per month. Replace that with the real VPS or Railway figure before publishing prices. A negative row in the margin API blocks that model.

## Muse rates the wallet uses

From [Meta Model API pricing](https://dev.meta.ai/docs/pricing-rate-limits), also listed on [Muse Code](https://dev.meta.ai/products/muse-code). Per 1M tokens:

| Model | Input | Cached input | Output | Use for |
| --- | --- | --- | --- | --- |
| `muse-spark-1.3-contributor` | $0.10 | $0.002 | $0.20 | Free grant only, and only after the person accepts Contributor mode. Meta may use that content to train. |
| `muse-spark-1.3` | $1.25 | $0.15 | $4.25 | Default paid model. Content is not used to train. |
| `muse-ember-1.0` up to 200K input | $0.10 | $0.004 | $0.50 | Optional on Plus and Pro. A request over 200K input is billed entirely at the long-context rate ($0.30 / $0.012 / $1.50). |
| `muse-wonder-1.0` | $4.00 | $0.20 | $20.00 | Pro only. One careless turn costs more than the whole free grant. |

Web search grounding is $2.50 per 1,000 searches. Muse Image is $0.01 per image. Leave both off the free grant. On paid hosted plans, count them against the same cent wallet.

There is no published Muse price in `server/model-prices.ts`. Add these four rows when the catalog is saved, with `asOf` set to the day they were checked.

### A turn, so the dollar grant means something

Meta does not publish an average turn. This mix is a planning assumption for a short coding step: **8,000 fresh input, 12,000 cached input, 800 output.**

| Model | Cost of that turn | What $0.012 buys |
| --- | --- | --- |
| Spark contributor | $0.00098 | about 12 turns |
| Spark standard | $0.0152 | less than 1 turn |
| Wonder | $0.050 | the grant is gone before the turn finishes |

A shorter chat (1,500 input, 400 output, no cache) is $0.0036 on Spark standard, so $0.012 is about 3 of those. Output-only, $0.012 is **2,823 Spark standard output tokens** (`floor(0.012 / 4.25 × 1,000,000)`).

Formula the admin screen should show, and the gateway should charge:

```text
debitUsd = (freshInput × inputPerMillion
         + cachedInput × cachedPerMillion
         + output × outputPerMillion) / 1_000_000
```

Refuse the turn before it starts when a conservative estimate (input already in the prompt, plus a reserved output budget) is above the remaining grant. That is what stops a Wonder call from going out and then failing the bill.

## Rates to put in admin

These are the starting values. They clear a card fee, about $1 of hosting, and a full burn of the included Muse cost. They are web prices. Phone store prices are in the next section.

### Free

| Field | Value |
| --- | --- |
| Grant | **$0.012 provider cost, once per account** |
| Model | `muse-spark-1.3-contributor` if they accept Contributor mode. Otherwise `muse-spark-1.3`. |
| Hard cap | Equal to the grant. No overage. No monthly reset. |
| Wonder, Ember, image, web search | Off |
| Extra limits | 20 requests a day, 2,000 output tokens a request, one grant per verified email and per install id |

$0.012 on contributor Spark is a real look at the product (about a dozen short coding steps) and costs us 1.2 cents. One thousand signups cost $12. The same $0.012 on standard Spark is a single short reply, which will not show the product. If Contributor mode is unacceptable, raise the free grant to **$0.05** of standard Spark (about 3 short coding turns, $50 per 1,000 signups) rather than pretending 2,800 output tokens is a trial.

Do not refresh the free grant every month. A bot loop on a monthly free cap is an invoice with no payer.

### Your model (bring your own key)

| Field | Value |
| --- | --- |
| Monthly fee | **$9** |
| Allowance | $0. We never see their token bill. |
| Fair use | 60 requests an hour, 2,000 a day, per workspace. This caps our CPU, not their model bill. |
| Ledger | `via: "byo"`. The gateway key is never attached. |

On a US card we keep about **$8.44** ($9 − 2.9% − $0.30). After $1 hosting, about **$7.40**, roughly 80% of the price. This is the profitable plan. OpenRouter can charge 5% of a huge BYOK volume because it is a router with a $25,000 monthly fee-free allowance ([OpenRouter pricing](https://openrouter.ai/pricing)). We are an app with a small user and a real server. A flat seat is collectable. A percent of a bill we do not issue is not.

Cursor's individual plans add no token fee on a user's own key. The person already paid for the editor ([Cursor](https://cursor.com/help/models-and-usage/api-keys)). Teams pay an extra $0.25 per million tokens. Copy the individual shape: the $9 is the whole platform fee. Add a per-token BYO fee only if an account passes the fair-use cap and still wants the app in the path. If that fee is added, use **$0.25 per million tokens** of their traffic, which is Cursor's team rate and does not require knowing their provider contract.

$9 is about half of hosted Starter. Wide enough that a heavy coder brings a key (we want that) and a light user pays $19 and leaves unused ration (we want that too).

### Maximus model

Included amounts are **what we pay Meta**, not a token face value. The hard cap equals the included amount. Spark standard is the default. The UI may say "about N Spark tokens" using the output rate, and must debit with the real input and output rates.

| Plan | Price / month | Muse cost included | If they use all of it | If they use half | Models |
| --- | --- | --- | --- | --- | --- |
| Starter | **$19** | **$8** | about $9.15 left after card fee and $1 hosting | about $13 | Spark standard |
| Plus | **$49** | **$22** | about $24 | about $35 | Spark, Ember under 200K |
| Pro | **$99** | **$40** | about $55 | about $75 | Spark, Ember, Wonder |

Card fee used above: 2.9% + $0.30. Starter at a full burn is $19 − $8 − $0.85 − $1. The included cost is under 55% of the price on every row (42%, 45%, 40%). That is the rule to keep when an admin edits the numbers: **included provider cost ≤ 50% of the price, hard cap = that cost.** Fifty percent leaves room for the card fee and hosting. Going to 70% makes a fully used Starter roughly break even and a refunded month a loss.

At the short-turn assumption, $8 is about 500 Spark turns, $22 about 1,400, $40 about 2,600. Wonder spends about $0.05 on that same turn, so Pro's $40 is about 800 Wonder turns. Show Wonder as a more expensive draw on the same wallet so people see it move.

### Overage, off by default

If the admin enables it:

- Sell at **1.6× the provider rate** (Spark standard becomes $2.00 input and $6.80 output per million).
- Stop again at **2× the included cost** in a month. Starter cannot run past $16 of Muse cost.
- 1.6× is about 37% margin before the card fee, about a third after it. Under 1.4× the fee eats the spread. OpenRouter's 5.5% credit fee is the wrong comparison: they do not wrap an agent, a desktop, and a phone.

The margin API must show a positive `marginPct` for every model the plan can select. Wonder with no sell price is an unbilled bundled turn.

### Phone prices

A 15% store cut on the web price shrinks the Starter net from about $18 to $16, and the $8 Muse cap becomes half of what we keep. Use higher store product prices, or sell the subscription on the web and let the phone show status.

| Plan | Web | Store, 15% cut, so we keep a similar net |
| --- | --- | --- |
| Your model | $9 | $12 |
| Starter | $19 | $24 |
| Plus | $49 | $59 |
| Pro | $99 | $119 |

At 30% store commission, do not sell the hosted plans inside the app. The Muse cap would consume the proceeds. Web checkout, phone display.

## How an admin should change a number

1. Read the current Muse row on the pricing page. If Spark standard output is no longer $4.25 / 1M, recompute every included dollar. Do not reuse this file's token counts.
2. Set included provider cost to at most half the price.
3. Set the hard cap equal to that cost.
4. Confirm `GET /api/admin/usage/margin` is positive for Spark, and for Wonder if Pro allows it.
5. Leave overage off until a month of real ledger rows shows most workspaces stop well under the cap.
6. Keep Your model at least $8 below Starter. If the gap closes, heavy users stay on our key and the cap becomes the whole business.

## Build order

1. **Admin profile.** One saved document next to `plans.json`: Muse model ids and the four rates, free grant USD (start `0.012`), contributor flag, Your-model fee, hosted price, included provider cost, hard cap, overage multiplier, second cap. The screen shows the computed Spark token equivalent next to the dollars. Reject a save when included cost is over half the price, or the hard cap is under the included cost.
2. **Wallet.** A balance beside the allowance: granted cents, spent cents, period start. Signup writes the free grant once. Each bundled gateway turn debits with the formula above and writes the ledger row it already writes. At zero, return the existing `spend_cap` 409. `via: "byo"` does not debit. Preflight-reject when the estimate exceeds the remainder.
3. **Two plans on the checkout we have.** Catalog ids `byo` and `hosted` (Starter / Plus / Pro are three hosted rows). Stripe and Paystack price ids stay in `MAXIMUS_STRIPE_PRICES` and `MAXIMUS_PAYSTACK_PLANS`. Invoice paid resets the hosted wallet to that period's included cost. A replayed webhook must not grant twice. Grace and suspension already exist. Sync the worker plan catalog in this step.
4. **Pooled key.** A Pool section on Admin → Keys, separate from a person's own bot keys. The admin pastes the Meta key. Store it like the other gateway secrets, mode `0600`, never return it, show set or unset and the last four characters. The gateway reads the store, then `MAXIMUS_GATEWAY_META_KEY` if the store is empty.
5. **Surfaces.** Pricing shows the free grant, Your model, and the three hosted prices, plus an Enterprise section that is not a self-serve token plan. Usage shows cents left and the Spark token equivalent. Desktop settings and the phone usage screen read the same wallet. The phone's current store products stay entitlement unlocks until the store price column above exists. Browser, desktop, and phone open only on the signed-in person's session. See Session gate.

## Session gate

The wallet is still one balance per workspace. The person who spends it is not. Browser, desktop, and phone each require that person's own sign-in. A shared `local-owner` is not a person, and it is not how those three screens open for a visitor.

| Screen | What "signed in" means |
| --- | --- |
| Browser | A browser never receives loopback trust (`server/request-auth.ts`, `fromBrowser`). The first visit is the sign-in page. The cookie is that person's session. Watching or driving the bot's browser uses that session, so two people do not share one hold. |
| Desktop | A packaged app uses service trust, so the window signs in before it can act. The owner header is that window's launch, not a second anonymous user. |
| Phone | Pairing happens after the account exists. The companion session is that person's. It does not inherit whoever last used the desktop. |

`/pricing` is the public door (`src/console/PricingPage.tsx`):

- Browser, Desktop, and Phone sit above the plans. Each card goes to `/signup` until a session exists, then to the app.
- Plan buttons do the same. A chosen paid plan is `/signup?plan=<id>`. A session that is already live skips signup and opens `/`.
- Enterprise (`/pricing#enterprise`) is a company workspace: SSO, spend controls, a deployment they run. Every person on it still signs up or signs in. It is not a fourth ration and it does not unlock the browser, desktop, or phone without a session. If the catalog has no `enterprise` row, signup keeps the account on the free grant and a person asks for the company workspace.
- "Already have an account? Sign in" is on the page for a returning person. The page reads `GET /api/auth/session` and, when that call is a live session, greets that email or device label.

Do not treat a loopback owner on a development server as a multi-user login. `MAXIMUS_DEV_TRUST_LOCAL_BROWSER=1` is the local exception and is ignored in a build, the desktop app, a hosted workspace, and Max Cloud.
6. **Proof, on an isolated workspace.** The free grant equals $0.012 at the saved rate. One bundled turn reduces it by the formula. A bring-your-own turn does not, and the pool key is absent from that request. A bundled turn never uses the user's key. A replayed invoice does not double the month. At zero the turn is refused. Your model still runs. A Wonder request on the free grant is refused before the provider is called. An unsigned browser is refused on `/api/bots/:id/browser/live` and on the local desktop routes. A second person's session does not ride the first person's cookie.

## Sources

- Meta Model API pricing and rate limits: https://dev.meta.ai/docs/pricing-rate-limits
- Muse Code plans and the same token rates: https://dev.meta.ai/products/muse-code
- Stripe card fees: https://stripe.com/pricing
- Apple Small Business Program, 15%: https://developer.apple.com/app-store/small-business-program/
- OpenRouter platform fee and BYOK: https://openrouter.ai/pricing
- Cursor own-key billing and the $0.25 / 1M team token rate: https://cursor.com/help/models-and-usage/api-keys
