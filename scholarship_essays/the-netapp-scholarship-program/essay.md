# The NetApp Scholarship Program

A cancer patient's radiation plan is, technically speaking, a dataset. Forty-odd grayscale images, a set of hand-drawn contours, and a stack of metadata about a machine that will fire on Thursday.

I learned that at sixteen, sitting at the treatment planning workstation in my uncle's radiation oncology clinic in North Dakota. He let me outline a tumor on an MRI — drag the cursor around the gray smudge, commit the contour, next slice, eleven minutes for the first one and forty more waiting. Every artifact I produced that afternoon was data that something downstream would trust completely and without asking where it came from.

That's the thing about data infrastructure that you can't really feel until you've been the source of the record. Everything downstream inherits your mistakes at full confidence.

So I've built the habit of being paranoid about the pipeline rather than the model. I'm the founding AI engineer at TABOOST — the largest social media agency in the United States, five million in profit last year — and the system I built there ingests, classifies, and routes over two hundred emails a day across sixteen inboxes. Most of that code isn't classification. It's the boring perimeter: what happens on a malformed input, what happens when an upstream service half-answers, what happens when the thing that was true yesterday about a message format silently isn't. Classification is the easy part. Everything that touches the outside world is the hard part.

I run Alta Investments the same way — a live quantitative trading system I built alone at eighteen, pulling a market data feed through a signal pipeline and out into real orders every trading day. The first component I wrote wasn't the strategy. It was the risk model that holds probability of ruin at zero, and a large fraction of what it actually does is refuse to act on data it doesn't trust.

Neither of those is what I'm ultimately building. They're where I learned that correctness at rest is a much smaller problem than correctness in motion.

The degree is biology, and the long project is software that proposes the tumor boundary so the physician verifies instead of traces. Clinical imaging at scale, in hospital systems, where the storage and the provenance and the integrity of a record are not an IT concern but a treatment concern.

Every one of those files has a person inside it, waiting on Thursday.

I've met one of them. That's mostly what this is about.
