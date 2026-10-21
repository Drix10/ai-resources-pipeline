// Stands in for LinkedInService's Claude in Chrome sessions: scan(source) gives a page's posts, thread(post) a
// post's comment section, people(search) a search page's people, result(action) the session's word on an
// action the gate let through. Actions go through the real gate decision (LinkedInService.decider), so their
// tracker marks, caps and stops are the pass's own. Returns a log ({ scanned, acted, said }) with restore().
const LinkedInService = require("../src/services/linkedin");
const claude = require("../src/services/claude");

function fakeLinkedIn({ scan = () => [], thread = () => ({ status: "open", comments: "", commenters: [] }), people = () => [], notifications = () => [], result = () => "done" } = {}) {
  const proto = LinkedInService.prototype;
  const saved = { scanPages: proto.scanPages, scanNotifications: proto.scanNotifications, readThreads: proto.readThreads, scanPeopleSearch: proto.scanPeopleSearch, act: proto.act };
  const log = { scanned: [], acted: [], notes: 0, searches: 0 };
  // (a post read off a page has its urn: the key the tests give it)
  const withUrn = (p) => ({ urn: /^urn:li:activity:\d+$/.test(p.key) ? p.key : "", ...p });
  proto.scanPages = async (sources) => sources.map((s) => { log.scanned.push(s.url || s.label); return { ...s, posts: scan(s).map(withUrn) }; });
  proto.scanNotifications = async () => { log.notes++; return notifications(); };
  proto.readThreads = async (posts) => new Map(posts.map((p) => [p.key, thread(p)]));
  proto.scanPeopleSearch = async (searches) => { log.searches += searches.length; return { blocked: false, results: searches.map((s) => ({ ...s, people: people(s) })) }; };
  proto.act = async (actions, opts) => {
    actions.forEach((a, i) => { a.id = a.id || `a${i + 1}`; });
    const decide = LinkedInService.decider(actions, opts);
    for (const a of actions) {
      const said = decide(a.id, a.kind === "comment" ? claude.textHash(claude.normText(a.text)) : "-");
      log.acted.push({ kind: a.kind, key: a.post?.key || a.url, said: said.split(":")[0] });
      a.result = said.startsWith("GO") ? result(a) : "skipped";
      if (a.error) throw a.error;
    }
    return actions;
  };
  log.restore = () => Object.assign(proto, saved);
  // What was done: the actions the gate let through, by kind.
  log.done = (kind) => log.acted.filter((x) => x.kind === kind && x.said === "GO").map((x) => x.key);
  return log;
}

module.exports = { fakeLinkedIn };
