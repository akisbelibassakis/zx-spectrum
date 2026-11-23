# Note to the ZXInfo / ZXDB maintainers (draft, to post yourself)

Where (pick one):
1. Recommended: a reply in the "ZXInfo API v3" thread on the Spectrum Computing forum, where Thomas
   (ZXInfo's author) announced the public API: https://www.spectrumcomputing.co.uk/forums/viewtopic.php?p=57952
   (needs a free forum account; new members' first posts may wait for approval).
2. Or a GitHub issue on the API's repository: https://github.com/thomasheckmann/zxinfo-api-v3/issues
   ("New issue"; needs a GitHub account; the repository is named v3 but is the one still being updated).

---

**Subject:** A browser emulator using the ZXInfo API v5 – thank you, and a heads-up

Hi Thomas and the ZXDB team,

I've made a ZX Spectrum emulator that runs in the browser, set on an 80s desk with a TV, a Datacorder and a
Multiface: https://akisbelibassakis.github.io/zx-spectrum/ (source: https://github.com/akisbelibassakis/zx-spectrum).

It has a small software catalogue drawn on the Spectrum's screen. It searches through
`https://api.zxinfo.dk/v5/search/<title>?mode=compact&size=30&contenttype=SOFTWARE&machinetype=ZXSPECTRUM`,
offers only titles marked "Available", and downloads the files from the World of Spectrum mirror on archive.org.
There is one request per search, made only when the user presses ENTER, with no background polling.
Games a user has downloaded are kept on their device (a rack of 8 tapes), so playing one again needs no new
search or download.

I'm about to share it on social media and wanted to let you know first, in case traffic rises.
If you'd prefer different parameters or a rate limit, or there's anything else you'd like me to do, please tell me.
The About page credits ZXDB and ZXInfo.

Thank you for ZXDB and ZXInfo. They made this possible.

Akis Belibassakis

---

## GitHub version (for an issue on thomasheckmann/zxinfo-api-v3)

**Title:** Heads-up: browser emulator using /v5/search (traffic may rise)

Hi Thomas,

I've made a ZX Spectrum emulator that runs in the browser: https://akisbelibassakis.github.io/zx-spectrum/
(source: https://github.com/akisbelibassakis/zx-spectrum). Its software catalogue searches ZXInfo with:

```
GET https://api.zxinfo.dk/v5/search/<title>?mode=compact&size=30&contenttype=SOFTWARE&machinetype=ZXSPECTRUM
```

- one request per search, only when the user presses ENTER; no background polling
- only titles marked "Available" are offered; files come from the World of Spectrum mirror on archive.org
- downloaded games stay on the user's device, so playing one again needs no new request
- ZXDB and ZXInfo are credited on the About page

I'm about to share it on social media, so traffic may rise for a while.
**Is this usage OK with you?** If you'd prefer other parameters, a different endpoint or a rate limit, I'll change it.

Thank you for ZXDB and ZXInfo. They made this possible.

Akis
