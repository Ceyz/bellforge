import { Reveal } from './Reveal'

export function SectionHeading({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string
  title: string
  lead?: string
}) {
  return (
    <Reveal className="mx-auto max-w-2xl text-center">
      <p className="font-micro text-xs tracking-[0.14em] text-forge-400">{eyebrow.toUpperCase()}</p>
      <h2 className="font-display mt-3 text-3xl leading-tight text-text-hi sm:text-4xl">{title}</h2>
      {lead && <p className="mt-4 leading-relaxed text-text-mid">{lead}</p>}
    </Reveal>
  )
}
