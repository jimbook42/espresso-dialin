# Historical transfer compatibility

The audit used the repository history for src/db.js, src/utils/grinderLogic.js, the historical App.jsx record writers, and the separate replay database. The fixtures reproduce those field shapes with disposable test values. They do not contain a copy of any user's browser data.

| Database version | Repository evidence | Persistent changes |
| --- | --- | --- |
| EspressoDialDB 1 | b05f544 (v0.1) | Beans, recipes and shots. String UUID primary keys, ISO timestamps, grinder fields and recommendation objects. No settings store. |
| EspressoDialDB 6 | fad7a80 (v0.2) | Added bean storage and rating indexes. |
| EspressoDialDB 10 | 777a703 (v1.1) | Added cold-storage indexes, shot grind indexes and the settings store. Writers added shot rating, bean age, brew ratio and Flair profile fields. |
| EspressoDialDB 11 | fce12dc and da86735 | Same four stores and keys. The db.js declaration was later mirrored in grinderLogic.js. Historical shot recommendation and settings fields remained in the rows. |
| EspressoDialDB 17 | 11d7e60 and current grinderLogic.js | Added finished-bean and persistent grind-setting indexes. Later features added non-indexed fields and settings rows, including selections and shot context. |
| EspressoDialLabReplay 1 | f786a9c | Separate singleton store with a video Blob, exact sample objects, dimensions, timing and metadata. |
| EspressoDialTransfer 1 | 80e28de | Destination-only recovery journal. It is not part of the user's shot history or export. |

The checked-in main database declarations go from 1 to 6, 10, 11 and 17. They do not have record-rewriting upgrade callbacks. Non-indexed fields were part of the saved rows throughout. Transfer reads complete records, including abandoned fields, and never calls a shot normalizer or fills missing columns. Existing shot readers continue to interpret older shot and grinder fields.

The original DIALIN01 archive and its checksums remain supported. Ordinary data still produces v1. Datasets that contain typed-array or DataView slices, ordered Maps/Sets, regular expressions, shared references, cycles or legacy own-property names use graph encoding in a v2 manifest. Ordered containers retain iteration order, and slices retain the shared buffer, byte offset and span. A v2 archive needs the updated importer. The reader rejects unknown versions before replacement. New archive revisions must keep the checked-in original-v1 fixture readable and verifiable through restore and re-export.

A historical global settings row with values that cannot be represented in JSON stays intact in IndexedDB. The derived local settings cache is cleared in that case so startup can read the authoritative row. The original PWA's databases are not changed by transfer testing.

The regression suite opens each historical schema in a temporary database, adds modern records after the existing application schema opens it, exports, restores into an isolated destination, reopens and re-exports. It compares all dataset checksums and checks the early records with the app's existing History/profile readers. The browser smoke also exercises mixed-age History and Stats. The checked-in archive fixture was made with the original writer at 7bd8c71. Physical Android validation and a migration of the user's actual archive are separate steps.
