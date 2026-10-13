// What a story is about, from keyword rules on its headline and lede (no AI). A story can be more than one kind
// ("injured star signs extension"). Order matters only for display: the first kind is the story's main label.
export type NewsKind =
  | 'injury'
  | 'transfer'
  | 'loan'
  | 'contract'
  | 'commitment'
  | 'coaching'
  | 'callup'
  | 'award'
  | 'ranking'
  | 'milestone'
  | 'report'
  | 'preview'
  | 'suspension';

export const KIND_LABEL: Record<NewsKind, string> = {
  injury: 'Injury',
  transfer: 'Transfer',
  loan: 'Loan',
  contract: 'Contract',
  commitment: 'Commitment',
  coaching: 'Coaching',
  callup: 'Call-up',
  award: 'Award',
  ranking: 'Ranking',
  milestone: 'Milestone',
  report: 'Match report',
  preview: 'Preview',
  suspension: 'Suspension',
};

/** How much a kind matters to a player or coach following a team (sets the order in Top stories). */
export const KIND_WEIGHT: Record<NewsKind, number> = {
  injury: 30, coaching: 30, transfer: 28, suspension: 24, callup: 24, loan: 20, contract: 18, commitment: 18,
  award: 14, ranking: 12, milestone: 12, preview: 8, report: 8,
};

// Each rule says where it may match: 'head' (the headline only) or 'any' (headline or lede). Loose patterns are
// headline-only, so a school recap that mentions "head coach Todd Yeagley said" is not a coaching story.
type Where = 'head' | 'any';
const RULES: [NewsKind, Where, RegExp][] = [
  ['injury', 'any', /\b(injur(y|ies|ed)(?![- ]time)|\bacl\b|\bmcl\b|hamstring|concussion|fractur\w*|torn (acl|mcl|meniscus|ligament|muscle)|sprain\w*|surgery|ruled out|out for (the )?(season|year|rest|\d+ (weeks|months))|sidelined|fitness (doubt|test)|out injured|stretchered off)/i],
  ['injury', 'head', /\b(knock|setback|limps? off|blow for|doubt for|miss(es)? (the )?(match|game|clash|rest))\b/i],
  ['suspension', 'any', /\b(suspend(ed|s)?|suspension|banned|ban for|disciplinary)\b/i],
  ['loan', 'any', /\b(on loan|loan (move|deal|spell)|loaned|joins? on loan|recall(ed)? from loan)\b/i],
  ['transfer', 'any', /\b(transfer (fee|window|target|portal)|signs? for|completes? (a |his |her )?(move|transfer)|agree(s|d)? (a )?(fee|transfer)|bid for|sign(s|ed)? \w+( \w+)? from|acquire[sd]? \w+( \w+)? from|free transfer|enters? the (transfer )?portal|transfer portal)\b/i],
  ['transfer', 'head', /\b(joins?|signs? with|signed by|in talks|move to|swoop|trade[sd]? (to|for)|released by|departs?\b|exit\b|seal(s|ed)? (a )?move|eyes? (a )?move|eyeing|linked with|transfer (rumou?rs?|news|talk)|want(s|ed)? to sign|close in on|closing in on)\b/i],
  ['contract', 'any', /\b(contract (extension|renewal)|extends? (his|her|their)? ?contract|re-?signs?\b|extension through|signs? (an? )?(new )?(contract )?extension|option (exercised|picked up)|new (multi-year )?(deal|contract) (with|at|through|until))\b/i],
  ['commitment', 'any', /\b(national letter of intent|signing day|(\d{4} )?(signing|recruiting) class|incoming class)\b/i],
  ['commitment', 'head', /\b(commit(s|ted|ment)?\b|verbal(ly)? commit|\bnli\b|signees?\b|signs? with)/i],
  ['coaching', 'any', /\b(appoint(s|ed|ment) (as |of )?(new )?(head |assistant )?(coach|manager|boss)|name[sd]? (new |interim )?(head |assistant )?(coach|manager)|hire[sd]? (as )?(new )?(head |assistant )?coach|(coach|manager|boss) (fired|sacked|dismissed|resigns|steps down|departs|leaves)|(fired|sacked|dismissed) (as )?(head coach|manager|coach)|parts? ways with (head )?(coach|manager)|new (head coach|manager|boss)|coaching (change|search|staff (addition|change)))\b/i],
  ['coaching', 'head', /\b(sacked|fired|steps down|resigns|new boss|head coach search|interim (head )?coach|names? .{0,30}(head )?coach\b)/i],
  ['callup', 'any', /\b(call(ed|s)?[- ]up|called into|national team (camp|roster|squad)|named to (the )?(\w+ )?(roster|squad)|(roster|squad) (named|announced) for|(usmnt|uswnt|u-?\d{2}s?) (camp|roster|squad)|first (senior )?cap|earns? (a |his |her )?(first )?cap)\b/i],
  ['award', 'any', /\b(named .{0,50}(player|goalkeeper|defender|forward|midfielder|rookie|freshman|coach|team|xi) of the (week|month|year|season)|player of the (week|month|year|match)|all-?americans?\b|all-(conference|region|big ten|acc|sec|big east|pac|american)|watch list|mac hermann|hermann trophy|golden (boot|ball|glove)|ballon d'or|team of the week|best xi|award (winner|finalist|semifinalist)|wins? .{0,30}award|honou?red\b|earns? .{0,30}honou?rs?)\b/i],
  ['ranking', 'head', /\b(rankings?\b|top 25|poll\b|rpi|moves? up to no\.|climbs? to no\.|(jumps?|rises?|climbs?|drops?|falls?) in (the )?(poll|rankings))/i],
  ['milestone', 'head', /\b(career[- ]high|record[- ](breaking|setting|equalling)|(school|program|club|league|all-time) record|hat[- ]trick|brace|first (career |professional |senior )?goal|\d+(st|nd|rd|th) (career )?(goal|win|appearance|cap|shutout|clean sheet)|milestone|all-time (leading|top)|unbeaten (run|streak)|winning streak)\b/i],
  ['report', 'head', /(\b\d+\s?[-–]\s?\d+\b|\b(beats?|defeat(s|ed)?|edges?|edged|tops|topped|routs?|routed|thrash(es|ed)?|draws? (with|at|against)|ties|tied with|falls? (to|at)|loses (to|at)|lost (to|at)|wins? (at|over|against)|victory over|comeback|stuns?|stunned|held to|blanks?|blanked|shuts? out|earns? (a )?(point|win|draw)|recap|match report|player ratings|drops?|dropped|falters?|faltered|upsets?|upset|win over|shutout win|lifts? \w+ (over|past|to)|powers? .{0,30} (to|in) (a )?(win|victory)|settles? for|drops?|dropped|falters?|faltered|upsets?|upset|falls? (just )?short|handles?|thumps?|rolls? past|takes care of|scores? (in|as|twice)|put (\w+) past|hit \w+ for (two|three|four|five|six|seven|\d)|fights? back to (win|beat|draw)|(in|to) (\w+ )?(win|victory|draw|loss|defeat)\b|scoring frenzy|ease past|cruise past|sink|down\b)\b)/i],
  ['preview', 'head', /\b(preview|hosts?\b|travels? to|visits?\b|welcomes?\b|faces?\b|takes? on|set to (face|meet|play)|ahead of|prepares? for|gameday|game day|matchday|predicted line-?up|team news|how to watch|kick-?off time|live stream|match central|continues .{0,40}\bagainst\b|match(es)? up (against|with)|schedule change|match central|heads? (to|north|south|east|west)|opens? .{0,40}\b(vs\.?|at)\b|road test|tilt\b)\b/i],
];

// A report is about a result; once a score or a result verb is there, preview words ("visit", "host") are just context.
const RESULT = /\b\d+\s?[-–]\s?\d+\b|\b(beat|defeat|rout|thrash|edge|fall to|lose to|victory|draw with)/i;

export function classify(title: string, lede = ''): NewsKind[] {
  const body = `${title} ${lede}`;
  const found = new Set<NewsKind>();
  for (const [kind, where, re] of RULES) if (re.test(where === 'head' ? title : body)) found.add(kind);
  let kinds = [...found];
  if (kinds.includes('report') && kinds.includes('preview') && RESULT.test(title)) kinds = kinds.filter((k) => k !== 'preview');
  // A loan is a kind of transfer; say loan only.
  if (kinds.includes('loan')) kinds = kinds.filter((k) => k !== 'transfer');
  // "Re-signs" and "extension" are contract news, not a transfer.
  if (kinds.includes('contract') && !/\b(joins?|from|move)\b/i.test(title)) kinds = kinds.filter((k) => k !== 'transfer');
  // A college commitment is not a pro transfer.
  if (kinds.includes('commitment')) kinds = kinds.filter((k) => k !== 'transfer');
  return kinds.sort((a, b) => KIND_WEIGHT[b] - KIND_WEIGHT[a]).slice(0, 3);
}
