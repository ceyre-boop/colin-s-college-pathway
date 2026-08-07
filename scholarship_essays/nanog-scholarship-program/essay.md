# NANOG Scholarship Program

The workstation took a couple of seconds to load each slice, and a person waited.

I was sixteen, at my uncle's radiation oncology clinic in North Dakota, outlining a tumor on an MRI so the radiation plan would know where to aim. Drag the cursor around the gray smudge, commit the contour, click to the next slice — and wait. Two seconds, maybe three. Then again. Forty-some times, plus every time you go back to fix one.

Nobody in that building would have called that a latency problem. It was just how long the thing took. But sit in it for an afternoon and the arithmetic gets loud: a few seconds of load, times forty slices, times the number of times a tired human re-does a contour, is a real fraction of the attention available for a treatment plan. The infrastructure wasn't failing. It was slow, quietly, into a workflow where attention is the actual scarce resource.

That's the day I got interested in the layer underneath things.

Because that's what I keep finding. The impressive part of a system is rarely where the outcome is decided — the outcome is decided by whether the boring layer stayed up and stayed fast on a normal Tuesday. I'm the founding AI engineer at TABOOST, the largest social media agency in the United States, five million in profit last year, and what I built there ingests, classifies, and routes over two hundred emails a day across sixteen inboxes. Nobody has ever complimented it. They'd notice within about four minutes if it stopped.

I also run Alta Investments, a live quantitative trading system I built alone at eighteen. It moves real capital off a live data feed every trading day. When something upstream hiccups, there's no queue to catch it and no colleague to page — the system either handles the degraded case correctly or it does something expensive.

Both taught me the same lesson, which is the one I'd bring to this: you don't get credit for uptime, and you shouldn't. Uptime is the floor. The interesting engineering is all in the failure modes nobody will ever see.

The degree is biology, and the long project is software that proposes the tumor boundary so the oncologist verifies instead of traces. That's a model problem on the surface. Underneath it's a systems problem — clinical data, hospitals, latency budgets, and a machine that fires on Thursday regardless.

Somebody has to care about the seconds.

I already do. I counted them.
