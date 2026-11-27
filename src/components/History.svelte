<script lang="ts">
  import { plotStart, type PlotRange, type QuantitySeries } from '../memory'
  import { i18n } from '../plugin'
  let { series, now, range }: { series: QuantitySeries; now: number; range: PlotRange } = $props()
  const start = $derived(plotStart(now, range))
  const period = $derived(i18n.t.ui.ranges[range]())
  const points = $derived(
    series.points.filter(
      (point, index) =>
        point.time >= start ||
        series.points[index + 1]?.time >= start ||
        index === series.points.length - 1,
    ),
  )
  const max = $derived(Math.max(1, ...points.map((point) => Number(point.value))))
  const x = (time: number) => 45 + Math.max(0, Math.min(1, (time - start) / (now - start))) * 290
  const y = (value: string) => 130 - (Number(value) / max) * 110
  const path = $derived(
    points
      .map(
        (point, index) =>
          `${index ? 'H' : 'M'} ${x(point.time)} ${index ? `V ${y(point.value)}` : y(point.value)}`,
      )
      .join(' '),
  )
</script>

<figure>
  <figcaption>{series.label} — {period}</figcaption>
  <svg
    viewBox="0 0 350 165"
    role="img"
    aria-label={`${series.label} ${i18n.t.ui.quantity()} — ${period}`}
    data-range={range}
    data-start={start}
  >
    <path d="M45 15V130H335" fill="none" stroke="currentColor" opacity="0.4" />
    <text x="40" y="24" text-anchor="end">{max.toLocaleString()}</text>
    <text x="40" y="134" text-anchor="end">0</text>
    <path d={path} fill="none" stroke="var(--color-primary-500)" stroke-width="2" />
    {#each points as point}
      <circle cx={x(point.time)} cy={y(point.value)} r="3" fill="var(--color-primary-500)">
        <title>{new Date(point.time).toLocaleString()}: {point.value}</title>
      </circle>
    {/each}
    <text x="45" y="155">{new Date(start).toLocaleDateString()}</text>
    <text x="335" y="155" text-anchor="end">{new Date(now).toLocaleDateString()}</text>
  </svg>
  {#if points.length >= 2}
    <details>
      <summary>{i18n.t.ui.history_details()}</summary>
      <table>
        <thead><tr><th>{i18n.t.ui.observed()}</th><th>{i18n.t.ui.quantity()}</th></tr></thead><tbody
        >
          {#each points as point}<tr
              ><td>{new Date(point.time).toLocaleString()}</td><td>{point.value}</td></tr
            >{/each}
        </tbody>
      </table>
    </details>
  {/if}
</figure>
