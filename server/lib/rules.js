// Squad tasks and proof link formats (the same list the site shows).
export const TASKS = {
  lore: { name: "Write the lore", proof: "x" }, meme: { name: "Meme forge", proof: "x" }, banner: { name: "Banner drop", proof: "x" },
  rally: { name: "Rally post", proof: "x" }, stickers: { name: "Sticker pack", proof: "x" }, explainer: { name: "60-second explainer", proof: "video" },
  space: { name: "Host an X Space", proof: "space" }, translate: { name: "Translations", proof: "x" }, memewar: { name: "Meme war", proof: "x" },
  anim: { name: "Mascot in motion", proof: "x" }, anthem: { name: "Anthem", proof: "video" }, collab: { name: "Cross-squad collab", proof: "x" },
  doc: { name: "Documentary", proof: "video" }, build: { name: "Build something", proof: "link" }, irl: { name: "IRL sighting", proof: "x" }
};
export const PROOF = {
  x: /^https:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})(?:[/?#].*)?$/i,
  space: /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/spaces\/[A-Za-z0-9]{6,}(?:[/?#].*)?$/i,
  video: /^https:\/\/(?:(?:www\.|mobile\.)?(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}|(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/)[\w-]{6,}|youtu\.be\/[\w-]{6,})(?:[/?#&].*)?$/i,
  link: /^https:\/\/[^\s<>"']{4,300}$/i
};
