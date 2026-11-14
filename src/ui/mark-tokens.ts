// The tokens that style the marks drawn inside the agent's page: pins,
// target outlines, text highlights, change marks and the hover outline while
// pointing. Each theme sets them in its CSS; the review page reads their
// values and sends them to the page's script (sdk.ts), which draws with them
// and with nothing else. Shared so both sides agree on the names.

export const MARK_TOKENS = [
  '--mk-font',
  '--mk-pin-bg',
  '--mk-pin-fg',
  '--mk-pin-border',
  '--mk-pin-radius',
  '--mk-pin-shadow',
  '--mk-pin-queued-bg',
  '--mk-pin-queued-fg',
  '--mk-pin-queued-border',
  '--mk-pin-agent-bg',
  '--mk-pin-agent-fg',
  '--mk-pin-agent-border',
  '--mk-pin-done-bg',
  '--mk-pin-done-fg',
  '--mk-pin-done-border',
  '--mk-pin-ask-bg',
  '--mk-pin-ask-fg',
  '--mk-pin-ask-border',
  '--mk-target-line',
  '--mk-target-line-queued',
  '--mk-target-line-agent',
  '--mk-target-offset',
  '--mk-target-radius',
  '--mk-target-bg',
  '--mk-target-bg-agent',
  '--mk-target-shadow',
  '--mk-text-bg',
  '--mk-text-bg-agent',
  '--mk-text-line',
  '--mk-hover-line',
  '--mk-hover-bg',
  '--mk-insert-bg',
  '--mk-insert-line',
  '--mk-removal-fg',
  '--mk-removal-bg',
  '--mk-removal-border',
] as const;

export type MarkToken = (typeof MARK_TOKENS)[number];
