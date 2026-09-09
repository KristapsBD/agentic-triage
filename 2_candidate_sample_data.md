# Sample Data — Fallback Exercise Only

> **Only relevant if you're doing the fallback bug-triage exercise.** Bringing your own
> showcase project to the live session? Then you don't need this file at all.

Load **Set A** into Gitea as existing open issues so your duplicate check has something to
compare against. Use **Set B** to develop and self-test. This is representative, not
exhaustive — in the live session we'll feed your service messier input, so build defensively.

## Set A — existing issues to preload into Gitea

**EXIST-1 — Login button unresponsive on mobile Safari**
Labels: `frontend`, `auth` · Severity: `high`
> Multiple users report that on iOS Safari the "Log in" button does nothing when tapped.
> Works fine on desktop Chrome. Started after the 3.4 release.

**EXIST-2 — CSV export times out for large datasets**
Labels: `backend` · Severity: `medium`
> Exporting a report with more than ~50k rows spins for a while and then returns a 504.
> Smaller exports are fine.

## Set B — sample incoming reports

**B1 (clean)**
> When I upload a profile picture larger than about 5MB, the page shows a spinner forever
> and the picture never saves. Tried an 8MB PNG and a 12MB JPEG, same result. Chrome on
> Windows. Smaller images work fine.

**B2 (likely duplicate of something in Set A)**
> I can't log in on my iPhone. I open the app in Safari, type my details, tap the login
> button and literally nothing happens. My colleague has the same problem on her phone.

Need more cases? Vague one-liners, screaming-but-cosmetic reports, bundled multi-issue
reports, log dumps with the signal buried — generate your own. Building your own test
inputs is part of the job, and we'll ask how you did it.

---

*Version: 2026-09-09*