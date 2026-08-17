# vhs script for the demo GIF: `vhs docs/demo.tape` writes docs/public/demo.gif
#
# Prerequisites:
#   * vhs (https://github.com/charmbracelet/vhs) and its ttyd/ffmpeg dependencies
#   * run from the REPO ROOT, not from docs/
#   * npm run build
#   * LINKWARDEN_URL and LINKWARDEN_TOKEN exported, pointing at an instance with a
#     few links, at least one of them preserved. docs/demo.mjs only reads, plus the
#     first call of delete_link, which returns a token and deletes nothing — but
#     record against a THROWAWAY instance regardless, because the GIF shows real
#     bookmark titles.
#
# Three beats: how many tools, the search → preserved-article-text pairing the
# server exists for, and the confirmation-token gate. Inside a Hide block use vhs's
# own Sleep — the shell's `sleep` blocks the tape and the recording ends before any
# output appears.

Output docs/public/demo.gif

Set Shell "bash"
Set FontSize 17
Set Width 1260
Set Height 520
Set Padding 22
Set Theme "Catppuccin Mocha"
Set TypingSpeed 28ms

Hide
Type "clear" Enter
Sleep 400ms
Show

Type "node docs/demo.mjs"
Sleep 700ms
Enter
Sleep 9s
