const test = require("node:test");
const assert = require("node:assert");
const { isEnglish } = require("../src/utils/helpers");

test("english posts and technical shorthand pass", () => {
  assert.ok(isEnglish("Shipping the new inference stack: latency dropped 40% and costs are down."));
  assert.ok(isEnglish("OpenAI GPT-5 benchmark MMLU 92.1 Nvidia H100"));
  assert.ok(isEnglish("Great point about margins, thanks for sharing."));
  assert.ok(isEnglish(""));
});

test("other languages are rejected", () => {
  assert.ok(!isEnglish("Estamos lanzando el nuevo modelo para todos los usuarios de la plataforma con mejoras"));
  assert.ok(!isEnglish("Wir haben das neue Modell mit der Plattform für alle Nutzer und nicht nur für Entwickler veröffentlicht"));
  assert.ok(!isEnglish("Nous lançons le nouveau modèle pour tous les utilisateurs de la plateforme avec des gains"));
  assert.ok(!isEnglish("新しいモデルを発表しました。開発者向けです。"));
});

test("links, mentions and hashtags do not count as language", () => {
  assert.ok(isEnglish("https://example.com/de/la/que @el_user #para The model is out and it works."));
});

test("a non-English comment fails validation", () => {
  const llm = require("../src/services/llm");
  const errs = llm.validateCommentReply("Gracias por compartir, es una muy buena idea para todos los equipos de la empresa.", "Post about team ideas", "Ana");
  assert.ok(errs.errors ? errs.errors.some((e) => /English/.test(e)) : JSON.stringify(errs).includes("English"));
});
