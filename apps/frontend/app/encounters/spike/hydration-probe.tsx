"use client";

import { useEffect, useState } from "react";

export function HydrationProbe() {
  const [status, setStatus] = useState("waiting for lightweight React hydration");
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    queueMicrotask(() => setStatus("lightweight React hydration complete"));
  }, []);

  return <section className="encounter-diagnostic-panel" aria-labelledby="hydration-probe-heading">
    <h2 id="hydration-probe-heading">Client Hydration Probe</h2>
    <p role="status">{status}</p>
    <button className="secondary-action compact-action" type="button" onClick={() => setClicks((value) => value + 1)}>
      Test React event ({clicks})
    </button>
  </section>;
}
