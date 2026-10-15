// The policy and information pages of Plaibook Stats (/about, /contact, /terms, /privacy, /sources, /data-use,
// /copyright, /corrections, /accessibility). Pure data, one copy: the server renders it for search engines and
// no-JavaScript readers (src/seo/legal.ts) and the app fetches it from /api/legal/:slug, so the two never differ.
// A block is a paragraph (string; [text](url) makes a link), { bullets }, or { table: { head, rows } }.
// Written for the free stats site; the paid Plaibook app (plaibook.soccer) has its own policies.

export const COMPANY = 'Plaibook Technologies, Inc.';
export const SITE_NAME = 'Plaibook Stats';
export const SITE = 'www.plaibook.live';
/** The one address on every page. Change it here only. */
export const CONTACT = 'support@plaibook.soccer';
export const UPDATED = 'October 15, 2026';

export type Block = string | { bullets: string[] } | { table: { head: string[]; rows: string[][] } };
export interface Section { id: string; heading: string; blocks: Block[] }
export interface LegalPage { slug: LegalSlug; path: string; title: string; nav: string; description: string; intro: string; sections: Section[]; form?: 'request' }
export type LegalSlug = 'about' | 'contact' | 'terms' | 'privacy' | 'sources' | 'data-use' | 'copyright' | 'corrections' | 'accessibility';

const B = (bullets: string[]): Block => ({ bullets });
const T = (head: string[], rows: string[][]): Block => ({ table: { head, rows } });
const mail = (subject: string) => `[${CONTACT}](mailto:${CONTACT}?subject=${encodeURIComponent(subject)})`;

const ABOUT: LegalPage = {
  slug: 'about', path: '/about', nav: 'About', title: 'About Plaibook Stats',
  description: 'Plaibook Stats is a free soccer statistics site for NCAA college soccer, professional leagues and international football, run by Plaibook Technologies, Inc.',
  intro: `${SITE_NAME} is a free soccer statistics site covering NCAA college soccer (Divisions I, II and III, men's and women's), professional leagues around the world and international football. It is run by ${COMPANY}, the company behind Plaibook, the coaching platform at plaibook.soccer. The Site is free to use; it is supported by advertising, sponsorships and paid data access.`,
  sections: [
    { id: 'what', heading: 'What you will find here', blocks: [B([
      'Scores, schedules, box scores, lineups and live games for every NCAA soccer program we can find, with team and player pages, conference tables, rankings, transfers and TV listings.',
      'Professional and international matches, tables, players and clubs, with an American focus (MLS, NWSL, USL, Americans abroad and the US national teams).',
      'Our own work on top of the numbers: Plaibook Elo ratings, a live RPI, match ratings, team of the week, win probability and season simulations.',
    ])] },
    { id: 'data', heading: 'Where the data comes from', blocks: [
      'We compile factual, publicly available information from public sources, licensed data providers and open data. Licence notices are on our [Credits](/sources) page. When sources disagree we show where, and we correct errors when they are reported.',
    ] },
    { id: 'independent', heading: 'Independent', blocks: [
      `${SITE_NAME} is independent. It is not affiliated with, endorsed by or sponsored by the NCAA, any conference, school, league, club or federation. Team names, logos and competition names are trademarks of their owners and are used only to identify the teams and competitions they belong to.`,
    ] },
    { id: 'contact', heading: 'Contact', blocks: [
      `Questions, corrections or press: see [Contact](/contact). To correct or remove information about a player, use [Corrections and removal](/corrections).`,
    ] },
  ],
};

const CONTACT_PAGE: LegalPage = {
  slug: 'contact', path: '/contact', nav: 'Contact', title: 'Contact',
  description: 'How to reach Plaibook Stats about corrections, removal requests, privacy, copyright, press and data access.',
  intro: `The quickest way to reach us is the request form on [Corrections and removal](/corrections), which goes straight to the people who keep the data. You can also email ${CONTACT}; please use the subject line below so your message reaches the right place.`,
  sections: [
    { id: 'who', heading: 'Who to contact about what', blocks: [T(['About', 'Use', 'Subject line'], [
      ['A wrong score, stat, name or position', 'The [request form](/corrections) or email', 'Correction'],
      ['Removing a player\'s details or photo', 'The [request form](/corrections) or email', 'Removal request'],
      ['Your personal information (privacy)', 'Email', 'Privacy request'],
      ['Copyright', 'Email (see [Copyright](/copyright))', 'Copyright notice'],
      ['Our crawler visiting your site', 'Email (see [Data use and bots](/data-use))', 'Crawler'],
      ['Data access, the API, partnerships', 'Email', 'Data access'],
      ['Advertising and sponsorships', 'Email', 'Advertising'],
      ['Press', 'Email', 'Press'],
    ])] },
    { id: 'company', heading: 'Company', blocks: [`${SITE_NAME} is operated by ${COMPANY}. Email: ${CONTACT}.`] },
  ],
};

const TERMS: LegalPage = {
  slug: 'terms', path: '/terms', nav: 'Terms of use', title: 'Terms of Use',
  description: 'The terms that apply when you use Plaibook Stats, including acceptable use, automated access, attribution and disclaimers.',
  intro: `These Terms of Use govern your use of ${SITE_NAME} at ${SITE}, its pages, its data and its public API (together, the "Site"), provided by ${COMPANY} ("we", "us"). By using the Site you agree to these Terms and to our [Privacy Policy](/privacy). If you do not agree, do not use the Site.`,
  sections: [
    { id: 'use', heading: 'Using the Site', blocks: [
      'The Site is free and needs no account. You may use it for personal, non-commercial purposes, and teachers, students, journalists, coaches and researchers may use and quote it in their work with attribution (see below). You must be at least 13 years old to use the Site.',
      'We may change, suspend or stop any part of the Site at any time.',
    ] },
    { id: 'acceptable', heading: 'Acceptable use', blocks: [
      'You agree not to:',
      B([
        'access the Site with automated means (scripts, bots, scrapers, crawlers) in a way that harms its performance, or above about 20 page requests a minute; use the [public API](/data-use) for automated access instead, within its limits;',
        'mirror, frame or republish the Site or substantial parts of its data, or use it to build a database or service that competes with the Site;',
        'use the Site or its data to train, fine-tune or evaluate artificial-intelligence models, except as our [robots.txt](/robots.txt) allows for search and answer engines;',
        'get around any rate limit, block or access control, or disguise automated access as a person;',
        'use the Site to harass, dox or threaten anyone, including players and coaches, or in breach of any law.',
      ]),
      'Search engines may crawl the Site as our robots.txt allows. We may block any address or client that breaks these rules.',
    ] },
    { id: 'attribution', heading: 'Sharing and attribution', blocks: [
      `You are welcome to share links, screenshots and individual numbers. When you use data from the Site, credit "${SITE_NAME}" and link to the page you used. Some data is adapted from openly licensed sources and carries its own licence (see [Credits](/sources)); keep those notices too.`,
    ] },
    { id: 'ip', heading: 'Intellectual property', blocks: [
      `The Site's design, text, charts, ratings, rankings and simulations, and the way the data is selected and arranged, belong to ${COMPANY} or its licensors. We claim no ownership of underlying facts such as scores and statistics. Team names, logos and competition names are trademarks of their owners; their use here identifies teams and does not mean any affiliation or endorsement. Data from providers and open-data projects remains subject to their licences.`,
    ] },
    { id: 'accuracy', heading: 'Accuracy and no betting advice', blocks: [
      'Statistics are compiled from many sources and can be incomplete, late or wrong. They are not official records. Ratings, probabilities, projections and simulations are estimates, not predictions you can rely on. Nothing on the Site is betting, financial, recruiting or professional advice. If you find an error, please [report it](/corrections).',
    ] },
    { id: 'third', heading: 'Links and third-party content', blocks: [
      'News headlines, pictures, watch links and other links lead to sites we do not control; their owners are responsible for them. We show a headline, the publisher and a link, and the picture a publisher supplies in its own feed, loaded from the publisher.',
    ] },
    { id: 'ads', heading: 'Advertising, sponsorships and paid features', blocks: [
      'The Site may show advertising and sponsored content, which we label as such. Advertisers are responsible for their ads and for the products and offers in them; an ad on the Site is not our endorsement. We may also offer paid features or paid API access, on terms shown when you sign up or buy. Ads are never aimed at players or based on information about them.',
    ] },
    { id: 'api', heading: 'The public API', blocks: [
      'Our college API at /v1 is offered for building apps and research. Requests without a key are limited (about 60 a minute); free and paid keys with higher limits are available (email us with the subject "Data access"). Professional and licensed data is not available through the API. You may not resell API data or present it as your own, and you must credit Plaibook Stats. We may change or withdraw the API or revoke a key at any time.',
    ] },
    { id: 'warranty', heading: 'Disclaimer of warranties', blocks: [
      'THE SITE AND ITS DATA ARE PROVIDED "AS IS" AND "AS AVAILABLE", WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING ACCURACY, COMPLETENESS, MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT, TO THE FULLEST EXTENT THE LAW ALLOWS.',
    ] },
    { id: 'liability', heading: 'Limitation of liability', blocks: [
      `TO THE FULLEST EXTENT THE LAW ALLOWS, ${COMPANY.toUpperCase()} WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR LOSS OF PROFITS, DATA OR GOODWILL, ARISING FROM YOUR USE OF THE SITE, AND OUR TOTAL LIABILITY FOR ANY CLAIM ABOUT THE SITE IS LIMITED TO ONE HUNDRED US DOLLARS ($100).`,
    ] },
    { id: 'indemnity', heading: 'Indemnity', blocks: [
      `You will indemnify ${COMPANY} against claims arising from your breach of these Terms or your misuse of the Site or its data.`,
    ] },
    { id: 'law', heading: 'Governing law', blocks: [
      'These Terms are governed by the laws of the State of Indiana, USA, without regard to its conflict-of-law rules. Any dispute will be heard in the state or federal courts located in Indiana, unless the law where you live gives you the right to a local court.',
    ] },
    { id: 'general', heading: 'General', blocks: [B([
      'If any part of these Terms is unenforceable, the rest stays in effect.',
      'Not enforcing a term is not a waiver of it.',
      'We may update these Terms; the date at the top says when they last changed, and continuing to use the Site means you accept the update.',
      `Questions: ${CONTACT}.`,
    ])] },
  ],
};

const PRIVACY: LegalPage = {
  slug: 'privacy', path: '/privacy', nav: 'Privacy', title: 'Privacy Policy',
  description: 'What Plaibook Stats collects (very little), what stays in your browser, how advertising would work, and the rights you have.',
  intro: `${SITE_NAME} has no accounts, and today it shows no advertising and sets no cookies. We may add advertising or sponsorships to keep the Site free; if that ever involves cookies or tracking, we will update this policy first and ask for your consent where the law requires it. This policy explains the little we collect when you visit ${SITE}, what stays in your own browser, and how we handle information about the athletes on the Site. It is provided by ${COMPANY}.`,
  sections: [
    { id: 'collect', heading: 'What we collect when you visit', blocks: [
      T(['What', 'Why', 'How long'], [
        ['Server logs: IP address, browser (user agent), page requested, time', 'Running the Site, security, stopping abuse and rate limiting', 'Kept by our host for a short period (days to a few weeks), then deleted'],
        ['Visit counts (cookie-free): pages viewed, section, referring site, device type', 'Knowing which pages people use', 'Kept only as daily totals'],
        ['Unique-visitor count', 'Counting visitors without tracking them', 'A one-way code made from your IP and browser with a secret that changes every day, held in memory for that day only; never stored with your IP'],
        ['Search terms typed into the Site\'s search', 'Improving search (which searches find nothing)', 'Kept as daily counts of terms, not linked to you'],
        ['What you send us: request-form entries and emails', 'Answering you', 'Until the request is closed and for 12 months after'],
      ]),
      'We do not collect names, emails or anything else unless you send it to us.',
    ] },
    { id: 'browser', heading: 'Cookies and what stays in your browser', blocks: [
      'Today we do not use cookies, tracking pixels, fingerprinting or third-party analytics. A few preferences are kept in your browser\'s local storage, on your device only, and are never sent to us: the teams and players you follow, and whether you are looking at men\'s or women\'s soccer. Clearing your browser\'s site data removes them.',
      'Advertising: if we add ads, sponsor ads we serve ourselves will not use cookies or track you. If we work with an advertising partner that uses cookies or similar technology, we will name the partner here, ask for your consent where the law requires it (for example in the EU and UK) and give you a way to say no.',
      'Some pages show pictures and logos loaded from other sites (publishers\' news pictures, team logos, player photos on school sites). Your browser fetches them directly; we ask it not to tell those sites which page you were on.',
    ] },
    { id: 'use', heading: 'How we use it, and who else sees it', blocks: [
      'We use this information only to run, secure and improve the Site. We do not sell personal information, today we show no ads and run no ad tracking, and we do not build profiles of visitors.',
      'Service providers that host the Site and its database process data for us under contract: Render (hosting) and Supabase (database), both in the United States. We may disclose information if the law requires it or to protect the Site and its users.',
      'If we later show ads from a partner that uses cookies or similar technology, sharing data with that partner for ads may count as a "sale" or "sharing" under some US state laws. Before that starts, we will add a "Your privacy choices" link that lets you opt out, and treat a Global Privacy Control signal from your browser as that opt-out.',
      'Browser "Do Not Track" and Global Privacy Control signals: we honour both.',
    ] },
    { id: 'athletes', heading: 'Information about athletes and coaches', blocks: [
      'The Site shows public athletic records: rosters, positions, class years, heights, hometowns, previous schools, game statistics and results, as published by schools, conferences, competitions and data providers. We do not show weights, majors or high schools, we do not collect college players\' birth dates, and we do not publish profiles of players under 18 in youth international competitions.',
      'If you are a player (or a parent or guardian of one) and want information corrected or removed, use [Corrections and removal](/corrections). Official game results and statistics stay, but we remove biographical details and photos on request and act quickly on anything that concerns safety or a minor.',
    ] },
    { id: 'rights', heading: 'Your rights', blocks: [
      'Wherever you live, you can ask us what personal information we hold about you, and ask us to correct or delete it. Residents of California and other US states with privacy laws, and of the EU and UK, have these rights by law; we extend them to everyone. Email us with the subject "Privacy request"; we answer within 30 days and will not treat you differently for asking.',
      'For visitors in the EU and UK: we rely on our legitimate interest in running and securing the Site for server logs and visit counts. Data is processed in the United States.',
    ] },
    { id: 'children', heading: 'Children', blocks: [
      'The Site is for a general audience and is not directed at children under 13. We do not knowingly collect personal information from children; if you believe a child has sent us information, contact us and we will delete it.',
    ] },
    { id: 'security', heading: 'Security', blocks: [
      'The Site is served only over HTTPS, access to our systems is limited, and we keep as little personal information as we can.',
    ] },
    { id: 'changes', heading: 'Changes and contact', blocks: [
      `We will update this policy if what we collect changes; the date at the top says when it last changed. Questions: ${mail('Privacy request')}, or ${COMPANY}.`,
    ] },
  ],
};

const SOURCES: LegalPage = {
  slug: 'sources', path: '/sources', nav: 'Credits', title: 'Credits',
  description: 'Licence notices for the open data used on Plaibook Stats.',
  intro: `Some of the data on ${SITE_NAME} is adapted from open sources whose licences ask for the notices below. Questions: ${CONTACT}.`,
  sections: [
    { id: 'wikipedia', heading: 'Wikipedia', blocks: [
      'Some historical league tables, player career lines and international caps are adapted from [Wikipedia](https://en.wikipedia.org/) articles (the article for the season, player or national team concerned), by Wikipedia contributors, licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). We have selected, combined and reformatted that material; tables built from it are shared under the same licence.',
    ] },
    { id: 'fjelstul', heading: 'The Fjelstul World Cup Database', blocks: [
      'World Cup squads and matches are adapted from the Fjelstul World Cup Database, © 2023 Joshua C. Fjelstul, Ph.D. ([github.com/jfjelstul/worldcup](https://github.com/jfjelstul/worldcup)), licensed under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). We have selected and reformatted the data; what we build from it is shared under the same licence.',
    ] },
    { id: 'news', heading: 'News', blocks: [
      'Headlines belong to their publishers. Each one names its publisher and links to the publisher\'s own page; we never copy articles. Some news links are found through the [GDELT Project](https://www.gdeltproject.org/).',
    ] },
    { id: 'marks', heading: 'Logos and names', blocks: [
      'Team names, logos and competition names are trademarks of their owners and are shown only to identify teams and competitions. No affiliation or endorsement is implied. Owners who want a logo removed can email us.',
    ] },
  ],
};

const DATA_USE: LegalPage = {
  slug: 'data-use', path: '/data-use', nav: 'Data use and bots', title: 'Data use, our crawler and bots',
  description: 'How Plaibook Stats collects data from other sites, the limits for bots and automated access, the public API and AI crawlers.',
  intro: 'This page explains how our own crawler behaves when it visits other sites, and the rules for anyone reading this Site automatically.',
  sections: [
    { id: 'crawler', heading: 'Our crawler', blocks: [
      'To keep scores and statistics current, our crawler reads public pages and feeds on school, conference and competition sites. It is built to be a light visitor:',
      B([
        'one request at a time per site, at most about one a second, with longer pauses when a site asks for them (Crawl-delay) or slows down;',
        'it reads robots.txt and does not visit pages a site asks crawlers not to read;',
        'it backs off and retries later when a site returns errors or "too many requests";',
        'it remembers pages and asks only whether they changed (so most visits are small);',
        'it reads only public pages, never anything behind a login, and stores facts (scores, statistics, rosters) rather than copying written content;',
        `every request carries our contact address (${CONTACT}) so a site owner can reach us.`,
      ]),
      `If you run a site and want us to visit less often or not at all, email ${mail('Crawler')} and we will act on it promptly.`,
    ] },
    { id: 'bots', heading: 'Reading this Site automatically', blocks: [
      'Search engines are welcome within our robots.txt. Other automated access must stay under about 20 page requests a minute and identify itself honestly; anything faster is limited or blocked. Please do not scrape the Site\'s internal /api/ endpoints, which are for the Site\'s own pages and are not a public interface.',
      'For data in bulk, use the public API (below) or ask us.',
    ] },
    { id: 'api', heading: 'The public API', blocks: [
      'The college API at /v1 returns programs, rosters, games, box scores, standings, rankings and leaders as JSON ([description](/v1/openapi.json)). Without a key it allows about 60 requests a minute; keys with higher limits are free for apps and research on request. Professional and licensed data is not available through the API. Credit Plaibook Stats wherever you use the data.',
    ] },
    { id: 'ai', heading: 'AI crawlers', blocks: [
      'Our robots.txt allows answer engines and AI search tools to read the Site so they can cite it with a link, and asks AI-training crawlers (such as GPTBot, ClaudeBot, Google-Extended, CCBot and Bytespider) not to use it for training. Using the Site\'s data to train AI models is not allowed under our [Terms of Use](/terms).',
    ] },
  ],
};

const COPYRIGHT: LegalPage = {
  slug: 'copyright', path: '/copyright', nav: 'Copyright', title: 'Copyright and DMCA',
  description: 'How to tell Plaibook Stats about copyrighted material, the counter-notice process and our repeat-infringer policy.',
  intro: `We respect the rights of others. If you believe material on the Site infringes your copyright, send a notice to our designated agent and we will remove or disable it promptly, as the Digital Millennium Copyright Act (17 U.S.C. §512) provides.`,
  sections: [
    { id: 'notice', heading: 'Sending a notice', blocks: [
      `Email ${mail('Copyright notice')} (Copyright Agent, ${COMPANY}) with:`,
      B([
        'your physical or electronic signature;',
        'the copyrighted work you believe is infringed;',
        'the material on the Site you want removed and its address (URL);',
        'your name, address, telephone number and email;',
        'a statement that you believe in good faith the use is not authorised by the owner, its agent or the law;',
        'a statement, under penalty of perjury, that the notice is accurate and that you are the owner or authorised to act for the owner.',
      ]),
    ] },
    { id: 'counter', heading: 'Counter-notice', blocks: [
      'If material you provided was removed and you believe that was a mistake, you may send a counter-notice with your signature, the material and where it appeared, a statement under penalty of perjury that it was removed by mistake or misidentification, and your name, address and telephone number with consent to the jurisdiction of the federal court for your district (or Indiana if you are outside the United States). We may restore the material 10 to 14 business days later unless the complainant tells us they have filed a court action.',
    ] },
    { id: 'repeat', heading: 'Repeat infringers', blocks: [
      'We block sources and users who repeatedly infringe copyright.',
    ] },
    { id: 'facts', heading: 'Facts and logos', blocks: [
      'Scores and statistics are facts and are not covered by copyright. For a logo or name (a trademark), or a photo of you, use [Corrections and removal](/corrections) or email us; we generally remove them on request.',
    ] },
  ],
};

const CORRECTIONS: LegalPage = {
  slug: 'corrections', path: '/corrections', nav: 'Corrections and removal', title: 'Corrections and removal requests',
  description: 'Report an error on Plaibook Stats, or ask for a player\'s details or photo to be corrected or removed.',
  intro: 'Found a wrong score, a misspelled name or a player in the wrong team? Want your details or photo taken down? Tell us here. We read every request.',
  form: 'request',
  sections: [
    { id: 'correct', heading: 'What we correct', blocks: [
      'Any error we can check: scores, statistics, names, positions, class years, hometowns, teams. A link to an official source (a box score, roster or school page) helps us fix it quickly. Many of our numbers come from school and conference sites; if their page is wrong, the fix is fastest when they correct it too.',
    ] },
    { id: 'remove', heading: 'What we remove on request', blocks: [
      B([
        'A player\'s biographical details (hometown, previous school, height) and photo, when the player or a parent or guardian asks;',
        'anything about a player under 18, and anything that raises a safety concern, at once;',
        'a whole player profile, in exceptional cases (for example safety); the player\'s name may still appear in official results and box scores, which are a record of games played.',
      ]),
      'We may ask you to confirm you are the player, a parent or guardian, or someone acting for them.',
    ] },
    { id: 'when', heading: 'How long it takes', blocks: [
      'We aim to answer within 10 business days, and sooner for safety and under-18 requests. Corrections reach the Site as soon as they are made; search engines may take a few days to catch up.',
    ] },
  ],
};

const ACCESSIBILITY: LegalPage = {
  slug: 'accessibility', path: '/accessibility', nav: 'Accessibility', title: 'Accessibility',
  description: 'Plaibook Stats aims to meet WCAG 2.2 AA. What we have done, known limits and how to tell us about a problem.',
  intro: `We want everyone to be able to use ${SITE_NAME}, including people who use screen readers, keyboards, magnification or other assistive technology. We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at level AA.`,
  sections: [
    { id: 'done', heading: 'What we have done', blocks: [B([
      'Every page works with a keyboard, with a skip link and visible focus.',
      'Tables have captions and header cells; charts carry a text summary of what they show.',
      'Colour is never the only way information is shown (results carry W, L or T; ratings show their number).',
      'Text and controls meet contrast guidelines on our dark theme, and pages work at 200% zoom and on small screens.',
      'Motion is kept small and follows your system\'s reduced-motion setting.',
    ])] },
    { id: 'limits', heading: 'Known limits', blocks: [B([
      'Some wide statistics tables need sideways scrolling on small screens.',
      'Interactive charts (match flow, percentile wheels) are summarised in text, but their minute-by-minute detail is easiest to read visually.',
      'Pictures and logos from other sites may lack descriptions; they are decorative and their names are given in text.',
    ])] },
    { id: 'feedback', heading: 'Tell us', blocks: [
      `If something does not work for you, email ${mail('Accessibility')} with the page and what happened. We aim to reply within 5 business days and to fix problems as quickly as we can. Last reviewed ${UPDATED}.`,
    ] },
  ],
};

export const LEGAL: Record<LegalSlug, LegalPage> = {
  about: ABOUT, contact: CONTACT_PAGE, terms: TERMS, privacy: PRIVACY, sources: SOURCES, 'data-use': DATA_USE,
  copyright: COPYRIGHT, corrections: CORRECTIONS, accessibility: ACCESSIBILITY,
};
export const LEGAL_SLUGS = Object.keys(LEGAL) as LegalSlug[];

/** Paragraph text split into plain text and [text](url) links, for both renderers. */
export function inlineParts(s: string): ({ text: string } | { text: string; href: string })[] {
  const out: ({ text: string } | { text: string; href: string })[] = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ text: m[1]!, href: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
