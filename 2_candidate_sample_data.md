# Sample Data (for the candidate)

Two sets below. Load **Set A** into Gitea as existing open issues so your duplicate check
has something to compare against. Use **Set B** as example inputs to develop and self-test
your service. This is representative, not exhaustive — during the live session we'll feed it
inputs that are messier than these, so build defensively.

---

## Set A — Existing issues to preload into Gitea

Create these as open issues in your repo before testing dedup.

**EXIST-1 — Login button unresponsive on mobile Safari**
Labels: `frontend`, `auth` · Severity: `high`
> Multiple users report that on iOS Safari the "Log in" button does nothing when tapped.
> Works fine on desktop Chrome. Started after the 3.4 release.

**EXIST-2 — CSV export times out for large datasets**
Labels: `backend` · Severity: `medium`
> Exporting a report with more than ~50k rows spins for a while and then returns a 504.
> Smaller exports are fine.

**EXIST-3 — Password reset email never arrives**
Labels: `backend`, `auth` · Severity: `high`
> Requesting a password reset shows a success message but no email is ever delivered.
> Checked spam. Happens for at least three different users.

**EXIST-4 — Dashboard charts render blank on first load**
Labels: `frontend` · Severity: `medium`
> On first page load the dashboard charts are empty. A manual refresh fixes it.
> Seems like a race with the data fetch.

---

## Set B — Sample incoming reports

Feed these into your service while developing.

**B1 (clean, straightforward)**
> When I upload a profile picture larger than about 5MB, the page shows a spinner forever
> and the picture never saves. Tried it with a 8MB PNG and a 12MB JPEG, same result.
> Chrome on Windows. Smaller images work fine.

**B2 (clean, different area)**
> The `/api/v2/orders` endpoint returns a 500 whenever the `status` query param is omitted.
> Passing `status=open` works. This started today. Reproduced with curl three times.

**B3 (vague / underspecified)**
> the reports thing is broken again pls fix

**B4 (severity mismatch — sounds urgent, is cosmetic)**
> CRITICAL!!! URGENT!!! The footer copyright year still says 2024 instead of 2025. This
> is extremely important and needs to be fixed immediately!!!

**B5 (likely duplicate of something in Set A)**
> I can't log in on my iPhone. I open the app in Safari, type my details, tap the login
> button and literally nothing happens. My colleague has the same problem on her phone.

**B6 (a feature request, not a bug)**
> It would be really nice if we could export reports to PDF as well as CSV. A lot of our
> customers ask for this.

**B7 (multiple issues bundled together)**
> A few things: the search bar sometimes returns no results even for exact matches, the
> date picker lets you select an end date before the start date, and also the mobile menu
> overlaps the header on small screens.

**B8 (noisy — buried signal)**
> hey so this happened again, see below, no idea whats going on
> ```
> [2025-06-01 09:14:22] INFO  request received
> [2025-06-01 09:14:22] DEBUG cache miss key=user:8831
> [2025-06-01 09:14:23] ERROR NullReferenceException in OrderService.Calculate() line 214
> [2025-06-01 09:14:23] INFO  returning 500
> ```
> basically checkout dies sometimes

---

*Version: 2026-08-03*
