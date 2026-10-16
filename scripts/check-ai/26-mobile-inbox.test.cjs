// LIVE FAILURE  |  the admin inbox was unusable on a phone: chats could not be switched, older
// conversations were cut off, the reply box sat below the fold (and under the keyboard), the
// customer drawer covered the conversation, and a draft could carry over to another customer.
// Facebook customers could not be answered at all. These tests pin the mobile behaviour.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = require('./lib.cjs');
const { draftFor, withDraft, mergeMessages, filterRows, computeUnread, dayLabel } = load('ai-rules/inbox.js');
const { isGroupRecipient } = load('intent.js');

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const DESK = 'src/app/admin/_components/ConversationDesk.tsx';
const CSS = 'src/app/inbox.css';
const desk = read(DESK);
const css = read(CSS);
const globals = read('src/app/globals.css');

// ---------------------------------------------------------------- 1-5. two screens, no stale chat
test('1. the phone layout starts on the conversation list (Screen A)', () => {
  assert.ok(desk.includes('const [mobileChat, setMobileChat] = useState(false)'), 'starts on the list');
  assert.ok(css.includes('.inbox:not(.mobileChat) .chatDesk { display: none; }'), 'list screen hides the chat pane');
  assert.ok(desk.includes('setMobileChat(false)'), 'a phone can go back to the list');
});

test('2/4. tapping a conversation opens that chat (A, then B)', () => {
  assert.ok(/onClick=\{\(\) => \{ setActiveId\(c\.id\); setMobileChat\(true\); \}\}/.test(desk), 'row tap opens the chat on the phone');
  assert.ok(desk.includes('setActiveId(c.id)'), 'A then B simply re-select the conversation');
});

test('3. Back returns to the conversation list', () => {
  assert.ok(desk.includes('className="chatBack miniBtn"') && desk.includes('&lt; Back'), 'visible back button in the chat header');
  assert.ok(css.includes('.chatBack { display: none; }'), 'hidden on desktop');
  assert.ok(/@media \(max-width: 900px\) \{ \.chatBack \{ display: inline-block; \} \}/.test(css), 'shown on phones');
});

test('5. opening B loads ONLY B messages (no stale messages from A)', () => {
  assert.ok(desk.includes('if (activeId) void loadDetail(activeId); else { setMsgs([]);'), 'changing conversation reloads the thread');
  assert.ok(desk.includes('if (cr?.messages) {') && desk.includes('setMsgs(cr.messages)'), 'the thread is replaced, never appended across chats');
  // The delta merge itself can never invent a message from another conversation.
  const a = [{ id: 1, sender: 'customer', body: 'A1' }];
  const b = [{ id: 2, sender: 'customer', body: 'B1' }];
  assert.deepEqual(mergeMessages(a, b).map((m) => m.body), ['A1', 'B1']);
  assert.deepEqual(mergeMessages([], b).map((m) => m.body), ['B1']);
});

// ---------------------------------------------------------------- 6/7/9/10. composer + channels
test('6. the reply composer is always reachable on a phone', () => {
  assert.ok(css.includes('.inbox.mobileChat'), 'phone chat screen has its own layout');
  assert.ok(css.includes('height: calc(100dvh - 150px)'), 'sized to the real phone viewport (keyboard aware)');
  assert.ok(/\.inbox\.mobileChat \.replyBox \{[^}]*position: sticky/.test(css), 'composer sticks to the bottom');
  assert.ok(css.includes('env(safe-area-inset-bottom)'), 'respects the phone safe area');
  // On the phone the desktop fixed box (which clipped the composer) must not apply any more.
  assert.ok(/\.inbox:not\(\.mobileChat\) \{[^}]*height: auto/.test(css), 'list screen is not a fixed-height box');
  assert.ok(globals.includes('.inbox{max-width:1450px;height:min(760px,calc(100vh - 190px))'), 'the desktop box still exists for desktop');
});

test('7. Send works from the phone and clears only that chat draft', () => {
  assert.ok(desk.includes('await post(`/api/admin/conversations/${activeId}/reply`, { text })'), 'send calls the reply API');
  assert.ok(desk.includes("withDraft(d, conversationId, '')"), 'clears the answered chat only');
  const reply = read('src/app/api/admin/conversations/[id]/reply/route.ts');
  assert.ok(reply.includes("outbound(Number(id),'human',text)"), 'the message appears in the transcript immediately');
  assert.ok(reply.includes('clearAiReply'), 'the pending AI reply is cancelled');
  assert.ok(reply.includes('pauseAi'), 'the AI stays quiet for that turn');
  assert.ok(reply.includes('sendMessenger'), 'Facebook/Messenger customers can be answered too');
});

test('8. the mobile conversation list scrolls through every conversation', () => {
  assert.ok(/\.inbox:not\(\.mobileChat\) \.chatList \{[^}]*overflow: visible/.test(css), 'the list scrolls with the page');
  assert.ok(desk.includes('{shown.map((c) => {'), 'every visible conversation is rendered');
  assert.ok(!desk.includes('slice(0, 30)'), 'the list is not silently capped in the UI');
  const inbox = read('src/lib/inbox.ts');
  assert.ok(inbox.includes('export const INBOX_LIMIT = 300'), 'the API provides up to 300 conversations');
});

test('9/10. WhatsApp AND Facebook conversations are both listed and both answerable', () => {
  const inbox = read('src/lib/inbox.ts');
  assert.ok(inbox.includes('co.channel'), 'the channel comes from the list query');
  assert.ok(!/WHERE[^`]*channel\s*=/.test(inbox), 'no hidden channel filter that would drop Facebook chats');
  assert.ok(desk.includes("chan chan-"), 'each row shows its channel');
  assert.ok(desk.includes("c.channel === 'facebook' ? 'FB' : 'WA'"), 'channel badge for Facebook and WhatsApp');
  assert.ok(desk.includes('<option value="all">All</option>') && desk.includes("useState<InboxFilter>('all')"), 'the default filter hides nothing');
  const f = filterRows([{ id: 1, channel: 'facebook', mode: 'ai' }, { id: 2, channel: 'whatsapp', mode: 'ai' }], 'all', '');
  assert.equal(f.length, 2, 'both channels are visible by default');
});

// ---------------------------------------------------------------- 11/12/13. live updates + drafts
test('11. live polling still runs on the phone', () => {
  assert.ok(desk.includes('visible ? 2500 : 15000'), 'live cadence kept');
  assert.ok(desk.includes('mergeMessages(prev, j.messages)'), 'live delta merge kept');
  assert.ok(desk.includes("setConn(fails.current >= 3 ? 'OFFLINE' : 'RECONNECTING')"), 'connection badge kept');
  assert.ok(desk.includes('setList(j.conversations)'), 'the list updates without a manual refresh');
});

test('12. polling never touches a draft', () => {
  const pollBody = desk.slice(desk.indexOf('async function poll()'), desk.indexOf('useEffect(() => { if (activeId) void loadDetail'));
  assert.ok(pollBody.length > 100, 'poll() found');
  assert.ok(!pollBody.includes('setText') && !pollBody.includes('setDrafts'), 'the poll cannot erase what staff are typing');
  assert.ok(desk.includes('draftFor(drafts, activeId)'), 'the composer reads the current chat draft');
});

test('13. drafts are per conversation and never leak to another chat', () => {
  let drafts = {};
  drafts = withDraft(drafts, 11, 'hello customer A');
  assert.equal(draftFor(drafts, 11), 'hello customer A');
  assert.equal(draftFor(drafts, 22), '', 'customer B starts empty');
  drafts = withDraft(drafts, 22, 'hi B');
  assert.equal(draftFor(drafts, 11), 'hello customer A', 'A draft survives while chatting to B');
  drafts = withDraft(drafts, 11, '');
  assert.equal(draftFor(drafts, 22), 'hi B', 'sending to A never clears B');
  assert.equal(draftFor(drafts, null), '');
  assert.deepEqual(withDraft({}, null, 'x'), {}, 'no draft without a conversation');
  assert.ok(desk.includes('const conversationId = activeId;'), 'send targets the conversation that was open');
});

// ---------------------------------------------------------------- 14/15. drawer + desktop
test('14. the customer drawer becomes a phone details sheet, not a permanent column', () => {
  assert.ok(desk.includes("window.matchMedia('(max-width: 900px)').matches") && desk.includes('setShowDrawer(false)'), 'closed by default on phones');
  assert.ok(desk.includes("showDrawer ? 'Hide details' : 'Details'"), 'a Details button opens it on demand');
  assert.ok(/\.inbox\.mobileChat \.contextDrawer \{[^}]*position: absolute/.test(css), 'it slides over the chat');
  assert.ok(css.includes('width: min(340px, 92vw)'), 'it never takes the whole screen');
});

test('15. desktop keeps the three-pane inbox', () => {
  assert.ok(css.includes('grid-template-columns: 320px minmax(0, 1fr) 320px'), 'list | chat | drawer');
  assert.ok(css.includes('.inbox.noDrawer { grid-template-columns: 320px minmax(0, 1fr); }'), 'drawer can be hidden');
  assert.ok(globals.includes('.chatList{border-right:1px solid #dce8f2;overflow-y:auto'), 'desktop list scrolls in its pane');
  assert.ok(desk.includes("className={'inbox' + (showDrawer ? '' : ' noDrawer')"), 'the desktop classes are unchanged');
});

// ---------------------------------------------------------------- the Facebook reply bug
test('16. Messenger customers are direct chats, not groups (the AI must answer them)', () => {
  assert.equal(isGroupRecipient('120363000000000000@g.us'), true, 'WhatsApp groups stay blocked');
  assert.equal(isGroupRecipient('1234567890123-1234567890123'), true, 'group id form stays blocked');
  assert.equal(isGroupRecipient('255700000001'), false, 'WhatsApp customer');
  assert.equal(isGroupRecipient('1234567890123456'), false, '15-16 digit Messenger PSID');
  assert.equal(isGroupRecipient('12345678901234567'), false, '17 digit Messenger PSID');
  assert.equal(isGroupRecipient(''), true, 'unknown recipient is never messaged');
  assert.equal(computeUnread({ last_inbound_id: 5, last_read_message_id: 4 }), 1);
  assert.equal(computeUnread({ last_inbound_id: 5, last_read_message_id: 5 }), 0);
  assert.equal(dayLabel(new Date().toISOString(), Date.now()), 'Today');
});
