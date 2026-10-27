// GUI terminals can inherit non-interactive flags from the launcher, and an
// already-running terminal app may retain a different environment of its own.
// Normalize at the final TUI boundary without selecting or persisting a theme.
export function interactiveEnvironment(env) {
  const next = { ...env };
  delete next.NO_COLOR;
  delete next.CLICOLOR;
  delete next.CLICOLOR_FORCE;
  if (next.FORCE_COLOR === '0') delete next.FORCE_COLOR;
  if (!next.TERM || next.TERM === 'dumb') next.TERM = 'xterm-256color';
  if (!next.COLORTERM) next.COLORTERM = 'truecolor';
  return next;
}

// Run inside the new macOS terminal surface, not merely in osascript's process.
export const interactiveShellSetup = 'unset NO_COLOR CLICOLOR CLICOLOR_FORCE; if [ "${FORCE_COLOR-}" = "0" ]; then unset FORCE_COLOR; fi; if [ -z "${TERM-}" ] || [ "$TERM" = "dumb" ]; then export TERM=xterm-256color; fi; if [ -z "${COLORTERM-}" ]; then export COLORTERM=truecolor; fi; ';
