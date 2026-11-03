# AMARA Windows 2.8.11

Hongguo catalog pages now have **Previous page** and **Next page** controls above and below the results. The App catalog uses cursor pagination and does not provide a total page count; the interface now uses its actual `hasMore` value for Hongguo as well as other providers. Controls disable while loading, at the first page, and at the end of the available feed. Numbered web catalogs retain their existing page limits.

Verification: renderer regression checks cover Hongguo cursor navigation, both pager locations, first/last pages, loading, numbered catalogs, and another provider. An isolated desktop test opened page 2 using Next, verified the last-page state, and returned using Previous. A live Hongguo check returned 76 titles on page 1 and 77 new titles on page 2. Availability and page contents can change upstream.

Existing download recovery, licensing, and automatic update checks are retained.
