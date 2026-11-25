# Android shot measurement and coverage

## Saved flow plots

Scale protocols decode weight in grams and timestamp notifications on arrival in JavaScript. Arrival jitter, batching, scale precision and moving a cup can all affect the apparent slope between two readings. A 0.1 g change across 1 ms gives a raw interval rate of 100 g/s. Pressure bands use signed net mass divided by observed duration from the original eligible scale intervals. Each interval must be bracketed by continuous camera readings in one pressure band.

Compact History and advanced flow plots calculate net weight change over the longest available trailing observation span from 0.2 to 0.5 seconds. The plot uses the last received weight at an identical timestamp. A missing interval over 0.5 seconds, a reset, an invalid or reversed observation, or a weight drop greater than 0.1 g starts a new plot segment. Estimates are drawn at observation times. A faster change than the available measurement span can resolve may be attenuated. The saved observations and the live estimator and stop detector retain their original inputs.

The flow axis uses a time-weighted outer Tukey fence (three interquartile ranges, with a minimum spread of 0.5 g/s) when at least four estimates exist. Estimates beyond the resulting rounded axis are marked at the axis edge, with time and rate available below the chart. A sustained high flow may expand the axis. Pressure uses its own axis.

## Pressure coverage and timing

- The advanced view uses saved app extraction start and end and the camera clock origin, with a maximum saved wall-clock drift of 250 ms. Samples before extraction or after the extraction end are excluded.
- The average uses trapezoidal integration across valid adjacent camera samples, divided by their summed durations. Breaks and intervals greater than 187.5 ms contribute zero observed time and no pressure area. Start and end margins are excluded from the integral.
- A partial observed average needs at least two continuous intervals and at least half of the timed extraction observed. The extraction-average label additionally requires at least 90% observed time, no internal breaks and both endpoint margins within 187.5 ms. This is an estimate from the observed intervals.
- Observed peak timing uses the first highest valid sample inside the extraction and is available even for one sample with trusted alignment. The true peak may fall in an unobserved period, and camera sampling can miss a peak between observations. Timed pre-infusion uses the app's offset to extraction start.
- Opt-in diagnostic JSON includes saved relative clock offsets, the coverage calculation and extraction-relative pressure breaks when available. The scale sampling summary counts duplicate and reversed timestamps, intervals under 20 ms, gaps over 500 ms and the strongest signed adjacent rates in the saved scale clock. These describe recorded observations. A retained device trace is required to establish the recording build and scale model.

## Remembered Android scale

After verified GATT setup and the first decodable weight, Android remembers the address per selected scale model in WebView storage. It tries once on entering an eligible live workflow, on an eligible cold start, or on returning to the foreground. Reconnect checks existing permissions and adapter status, uses the remembered address and skips the chooser. Native GATT connect has an 8-second timeout. After protocol setup, the app waits up to 4 seconds for a valid weight. Manual retry and pairing remain available. A deliberate disconnect suppresses automatic reconnection for that model in the current app instance. Active shots keep their original scale session, including any observations saved before a disconnect.
