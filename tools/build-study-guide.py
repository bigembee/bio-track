#!/usr/bin/env python3
"""
Bio Track - study guide generator
---------------------------------------------------------------
Builds docs/Bio-Track-Study-Guide.pdf: a file-by-file, concept-by-concept
walkthrough of the codebase for people learning HTML, CSS and JavaScript
on it.

    python tools/build-study-guide.py

Needs reportlab (pip install reportlab). Uses the Segoe UI and Consolas
fonts shipped with Windows so naira signs, arrows and dashes render.
"""
from pathlib import Path
from datetime import date
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Frame, KeepTogether, PageBreak,
                                PageTemplate, Paragraph, Preformatted, Spacer,
                                Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'docs' / 'Bio-Track-Study-Guide.pdf'

# ---------------------------------------------------------------- fonts

FONTS = Path('C:/Windows/Fonts')
pdfmetrics.registerFont(TTFont('Body', FONTS / 'segoeui.ttf'))
pdfmetrics.registerFont(TTFont('Body-Bold', FONTS / 'segoeuib.ttf'))
italic = FONTS / 'segoeuii.ttf'
pdfmetrics.registerFont(TTFont('Body-Italic', italic if italic.exists() else FONTS / 'segoeui.ttf'))
pdfmetrics.registerFont(TTFont('Mono', FONTS / 'consola.ttf'))
pdfmetrics.registerFont(TTFont('Mono-Bold', FONTS / 'consolab.ttf'))
registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic', boldItalic='Body-Bold')
registerFontFamily('Mono', normal='Mono', bold='Mono-Bold', italic='Mono', boldItalic='Mono-Bold')

# ---------------------------------------------------------------- palette (from styles.css)

CANOPY_900 = colors.HexColor('#0d2a1c')
CANOPY_800 = colors.HexColor('#14432c')
CANOPY_600 = colors.HexColor('#1f6a45')
CANOPY_100 = colors.HexColor('#d9ebe1')
HUSK_100 = colors.HexColor('#eef1e8')
HUSK_200 = colors.HexColor('#e2e7d8')
SOIL_900 = colors.HexColor('#241a12')
MILLET_400 = colors.HexColor('#e3b23c')
MILLET_100 = colors.HexColor('#fbf0d4')
LATERITE_100 = colors.HexColor('#f8e6dd')
LATERITE_500 = colors.HexColor('#c2562c')
INK = colors.HexColor('#171a13')
INK_2 = colors.HexColor('#54584c')
INK_MUTED = colors.HexColor('#8a8d80')
CRIT_BG = colors.HexColor('#fdf1f1')
CRIT = colors.HexColor('#d03b3b')

# ---------------------------------------------------------------- styles

def style(name, **kw):
    base = dict(fontName='Body', fontSize=10, leading=14.5, textColor=INK, spaceAfter=6)
    base.update(kw)
    return ParagraphStyle(name, **base)

S = {
    'body': style('body'),
    'small': style('small', fontSize=8.5, leading=12, textColor=INK_2),
    'h1': style('h1', fontName='Body-Bold', fontSize=22, leading=27, textColor=CANOPY_900, spaceBefore=6, spaceAfter=10, keepWithNext=1),
    'h2': style('h2', fontName='Body-Bold', fontSize=14.5, leading=19, textColor=CANOPY_800, spaceBefore=16, spaceAfter=6, keepWithNext=1),
    'h3': style('h3', fontName='Body-Bold', fontSize=11, leading=15, textColor=CANOPY_600, spaceBefore=10, spaceAfter=4, keepWithNext=1),
    'eyebrow': style('eyebrow', fontName='Mono', fontSize=8, leading=11, textColor=INK_MUTED, spaceAfter=2),
    'code': ParagraphStyle('code', fontName='Mono', fontSize=8.2, leading=10.6, textColor=INK,
                           backColor=HUSK_100, borderPadding=(6, 8, 6, 8), leftIndent=0, spaceBefore=4, spaceAfter=10),
    'bullet': style('bullet', leftIndent=14, bulletIndent=3, spaceAfter=3),
    'cell': style('cell', fontSize=8.8, leading=12, spaceAfter=0),
    'cellb': style('cellb', fontName='Body-Bold', fontSize=8.8, leading=12, spaceAfter=0),
    'cover_title': style('cover_title', fontName='Body-Bold', fontSize=36, leading=42, textColor=colors.white, spaceAfter=8),
    'cover_sub': style('cover_sub', fontSize=13, leading=19, textColor=colors.HexColor('#d9ebe1'), spaceAfter=6),
    'cover_meta': style('cover_meta', fontName='Mono', fontSize=9, leading=13, textColor=colors.HexColor('#a7d2ba')),
    'toc1': style('toc1', fontName='Body-Bold', fontSize=11, leading=16, spaceAfter=2),
    'toc2': style('toc2', fontSize=9.5, leading=13.5, leftIndent=14, spaceAfter=1),
    'callout': style('callout', fontSize=9.5, leading=13.5, spaceAfter=4),
}

# ---------------------------------------------------------------- helpers

story = []

def esc(t):
    return escape(t)

def c(t):
    """Inline code inside a paragraph."""
    return '<font face="Mono" size="8.6">' + esc(t) + '</font>'

def H1(t):
    story.append(Paragraph(t, S['h1']))

def H2(t):
    story.append(Paragraph(t, S['h2']))

def H3(t):
    story.append(Paragraph(t, S['h3']))

def P(t, st='body'):
    story.append(Paragraph(t, S[st]))

def EYE(t):
    story.append(Paragraph(esc(t).upper(), S['eyebrow']))

def CODE(t):
    story.append(Preformatted(t.strip('\n'), S['code']))

def BUL(items):
    for it in items:
        story.append(Paragraph(it, S['bullet'], bulletText='•'))

def SP(h=6):
    story.append(Spacer(1, h))

def CALLOUT(kind, title, body_lines):
    """A tinted box with a coloured left rule. kind: try | why | watch | fix"""
    tints = {
        'try': (CANOPY_100, CANOPY_600, 'TRY THIS'),
        'why': (HUSK_100, INK_MUTED, 'WHY IT IS BUILT THIS WAY'),
        'watch': (MILLET_100, MILLET_400, 'WATCH OUT'),
        'fix': (CRIT_BG, CRIT, 'A BUG WORTH REMEMBERING'),
    }
    bg, rule, label = tints[kind]
    inner = [Paragraph('<font face="Mono" size="7.5" color="%s">%s</font>' % (rule.hexval(), label), S['callout']),
             Paragraph('<b>%s</b>' % title, S['callout'])]
    for line in body_lines:
        inner.append(Paragraph(line, S['callout']))
    t = Table([[inner]], colWidths=[None])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), bg),
        ('LINEBEFORE', (0, 0), (0, -1), 3, rule),
        ('LEFTPADDING', (0, 0), (-1, -1), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(KeepTogether(t))
    SP(8)

def TABLE(header, rows, widths=None, mono_first=False):
    data = [[Paragraph(esc(h), S['cellb']) for h in header]]
    for r in rows:
        row = []
        for i, cell in enumerate(r):
            txt = cell if cell.startswith('<') else esc(cell)
            if mono_first and i == 0:
                txt = c(cell)
            row.append(Paragraph(txt, S['cell']))
        data.append(row)
    t = Table(data, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HUSK_200),
        ('LINEBELOW', (0, 0), (-1, 0), 0.8, INK_MUTED),
        ('LINEBELOW', (0, 1), (-1, -1), 0.3, HUSK_200),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(t)
    SP(8)

# ---------------------------------------------------------------- document template with TOC + page furniture

class Guide(BaseDocTemplate):
    def __init__(self, filename, **kw):
        super().__init__(filename, pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm,
                         topMargin=22 * mm, bottomMargin=20 * mm, title='Bio Track - Study Guide to the Code',
                         author='Bio Track team', **kw)
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id='main')
        self.addPageTemplates([
            PageTemplate(id='cover', frames=[Frame(0, 0, A4[0], A4[1], id='cover', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.cover_page),
            PageTemplate(id='body', frames=[frame], onPageEnd=self.body_page),
        ])
        self.section = ''

    def cover_page(self, canv, doc):
        canv.saveState()
        canv.setFillColor(CANOPY_900)
        canv.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
        canv.setFillColor(CANOPY_800)
        canv.rect(0, A4[1] * 0.36, A4[0], A4[1] * 0.64, fill=1, stroke=0)
        canv.setFillColor(SOIL_900)
        canv.rect(0, A4[1] * 0.36 - 14 * mm, A4[0], 14 * mm, fill=1, stroke=0)
        canv.setFillColor(MILLET_400)
        canv.setFont('Mono', 8)
        canv.drawString(20 * mm, A4[1] * 0.36 - 9 * mm, 'MARKET BOARD   ·   CROPS · ₦/KG   ·   MAIZE ₦880.95   ·   RICE (PADDY) ₦1,074.07   ·   CASSAVA ₦562.71')
        canv.restoreState()

    def body_page(self, canv, doc):
        canv.saveState()
        canv.setFont('Mono', 7.5)
        canv.setFillColor(INK_MUTED)
        canv.drawString(doc.leftMargin, A4[1] - 14 * mm, 'BIO TRACK · STUDY GUIDE TO THE CODE')
        canv.drawRightString(A4[0] - doc.rightMargin, A4[1] - 14 * mm, self.section.upper())
        canv.setStrokeColor(HUSK_200)
        canv.setLineWidth(0.5)
        canv.line(doc.leftMargin, A4[1] - 16 * mm, A4[0] - doc.rightMargin, A4[1] - 16 * mm)
        canv.drawCentredString(A4[0] / 2, 11 * mm, str(doc.page))
        canv.restoreState()

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph):
            st = flowable.style.name
            text = flowable.getPlainText()
            if st == 'h1':
                self.section = text
                self.notify('TOCEntry', (0, text, self.page))
                key = 'h1-%d' % self.page
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level=0, closed=False)
            elif st == 'h2':
                self.notify('TOCEntry', (1, text, self.page))

# =====================================================================
#  CONTENT
# =====================================================================

# ---------------------------------------------------------------- cover

story.append(Spacer(1, 62 * mm))
cover_block = [
    Paragraph('Bio Track', S['cover_title']),
    Paragraph('A study guide to the code', ParagraphStyle('ct2', parent=S['cover_title'], fontSize=22, leading=28, textColor=colors.HexColor('#a7d2ba'))),
    Spacer(1, 10),
    Paragraph('A file-by-file, concept-by-concept walkthrough of the agricultural intelligence dashboard, '
              'written for a team learning HTML, CSS and JavaScript on a real codebase.', S['cover_sub']),
    Spacer(1, 22),
    Paragraph('30 source files · about 8,000 lines · 5 pages · 6 services · 2 live APIs', S['cover_meta']),
    Paragraph('Generated %s from the code as it stands' % date.today().strftime('%d %B %Y'), S['cover_meta']),
]
t = Table([[cover_block]], colWidths=[A4[0] - 40 * mm])
t.setStyle(TableStyle([('LEFTPADDING', (0, 0), (-1, -1), 20 * mm), ('RIGHTPADDING', (0, 0), (-1, -1), 20 * mm)]))
story.append(t)
story.append(Spacer(1, 120 * mm))
story.append(Paragraph('<font color="#a7d2ba">Read it with the code open. Every section names the file and the function it is describing.</font>',
                       ParagraphStyle('cf', parent=S['cover_meta'], leftIndent=20 * mm)))
from reportlab.platypus import NextPageTemplate
story.append(NextPageTemplate('body'))
story.append(PageBreak())

# ---------------------------------------------------------------- TOC

H1('Contents')
toc = TableOfContents()
toc.levelStyles = [S['toc1'], S['toc2']]
story.append(toc)
story.append(PageBreak())

# ---------------------------------------------------------------- how to use

H1('How to use this guide')
P('This is not a tutorial on JavaScript. It is a map of <b>this</b> codebase: what each file does, how the files talk to '
  'each other, why they are shaped the way they are, and the maths behind every number on screen. It assumes you can '
  'read a function and follow an <b>if</b>; everything else is explained the first time it appears.')
P('It is organised in layers. Read Part 1 straight through; it is short and everything else hangs off it. Read Part 2 '
  'before you open any file, because the same eight patterns appear in all of them. Part 3 is the reference: one section '
  'per file, in the order the browser loads them. Parts 4 and 5 are where understanding turns into confidence, trace the '
  'walkthroughs with the browser DevTools open, and check the worked examples against the numbers on your screen.')
P('Three kinds of box appear throughout:')
BUL([
    '<b>Try this</b>, something to do in the editor or the browser. Do them; that is the whole point.',
    '<b>Why it is built this way</b>; the reasoning behind a choice you might otherwise change.',
    '<b>Watch out</b>; a mistake that is easy to make in exactly this spot.',
])
P('Whenever the guide says “open the console”, it means the browser DevTools: right-click the page → <b>Inspect</b> → the '
  '<b>Console</b> tab. Errors appear there in red with the file and line number. The <b>Network</b> tab shows every request '
  'the page makes, and the <b>Elements</b> tab shows the live HTML and the CSS rules hitting each element.')

CALLOUT('fix', 'How a find-and-replace once broke three pages', [
    'When the brand was renamed from AgroSense to Bio Track, the replace hit the last line of three files, '
    + c('js/pages/cockpit.js') + ', ' + c('js/pages/farm.js') + ' and ' + c('js/pages/live.js') + ', turning '
    + c('})(window.AgroSense);') + ' into ' + c('})(window.Bio Track);') + '.',
    'A JavaScript identifier cannot contain a space, so that line was a <b>syntax error</b>. The browser refused to run '
    'any of the file, the page module never registered itself, and every value on those pages sat at “, ”. The console '
    'said <i>Uncaught SyntaxError: missing ) after argument list</i>; the clue was there the whole time.',
    '<b>The fix</b> was one word on the last line of each of those three files: ' + c('window.AgroSense') + ' put back. '
    'The brand name shown on screen is a <i>string</i> (' + c("'Bio Track'") + ' in shell.js) and can be anything; '
    + c('AgroSense') + ' in ' + c('window.AgroSense') + ' is a <i>variable name</i>, and every file must use the same one. '
    'A global replace cannot tell the two apart, which is the lesson.',
    'You can catch this kind of thing before opening a browser: ' + c('node --check js/pages/cockpit.js') + ' parses a file '
    'and prints any syntax error. Running it over every file takes a second.',
])

# ---------------------------------------------------------------- running it

H2('Running the project')
P('There is no build step and nothing to install. The site is plain HTML, CSS and JavaScript, plus one library (Chart.js) '
  'loaded from a CDN. It needs to be served over HTTP rather than opened as a file, because the pages fetch data from two '
  'external APIs and read each other’s state from browser storage. Any static server will do:')
CODE('''
python tools/devserver.py          # then open http://localhost:5173/
# or VS Code: install "Live Server", right-click index.html -> Open with Live Server
''')
P('Use ' + c('tools/devserver.py') + ' rather than ' + c('python -m http.server') + '. It is the same static server with '
  'caching switched off. Plain http.server lets the browser hold on to a ' + c('.js') + ' file it has already seen, so you '
  'edit a file, reload, and sit there debugging code that is no longer on disk; a genuinely maddening hour until you '
  'spot it. If a change ever seems not to apply, that is the first thing to suspect.')
P('The landing page is ' + c('index.html') + '. “Log in” is a plain link to ' + c('cockpit.html') + '; there is no '
  'authentication, by design. The four dashboard pages share a sidebar; the bell in the top bar carries the same alerts '
  'to all of them.')

story.append(PageBreak())

# =====================================================================
#  PART 1
# =====================================================================

H1('Part 1; The big picture')

H2('1.1 What the software is for')
P('Commercial farmers lose money on yesterday’s news: they sell into a dip because they did not know the price had moved, '
  'or they spray before a storm, or they harvest into a wet week. Bio Track is a <b>decision cockpit</b>: it pulls live '
  'weather for the farm’s own coordinates and real market prices, joins them to what the farm actually holds, lots in '
  'store, crops in the ground, animals on the hoof, and turns the join into things to do today.')
P('Everything on screen is one of three joins:')
TABLE(['The join', 'The question it answers', 'Where it lives'], [
    ['Stock × price', 'What is the farm worth right now, and what did the last month do to that?', 'analytics.js, livestock.js'],
    ['Forecast → action', 'What should I do, or not do, in the next 72 hours?', 'weather.js, irrigation.js, pests.js, harvest.js, livestock.js'],
    ['Rules → constraints', 'What am I not allowed to sell, and for how long?', 'pests.js → analytics.js'],
], widths=[38 * mm, 78 * mm, 54 * mm])

H3('The look, in one paragraph')
P('A soft neutral workspace: the app is one rounded panel floating on a grey backdrop, with an icon rail down the left and '
  'the content scrolling on the right. No borders, no shadows, layering is done with tone alone. One saturated green marks '
  'the single most important number on each screen, black marks the price board and the active nav chip, and the reserved '
  'status colours mark state. The restraint is the point: when almost everything is grey, the one green tile is unmissable.')

H2('1.2 The five pages')
TABLE(['File', 'What it shows', 'Page module'], [
    ['index.html', 'Landing page. Three honest telemetry chips (live weather, a real WFP price, the next harvest) and a “Log in” link.', 'js/landing.js (standalone)'],
    ['cockpit.html', 'The one-glance answer: farm value with a 24-month history, five stat tiles, sell priority, advisories, harvest calendar.', 'js/pages/cockpit.js'],
    ['live.html', 'The two external feeds with their provenance: the seven-day forecast charts; market tables, trend charts and the source card.', 'js/pages/live.js'],
    ['operations.html', 'Irrigation control (soil water deficit per zone, valves) and pest control (degree days, infection windows, spray window, treatments).', 'js/pages/operations.js'],
    ['farm.html', 'Lots in store (sortable), fields with the harvest calendar, and livestock (valuation, heat stress, health calendar).', 'js/pages/farm.js'],
], widths=[34 * mm, 94 * mm, 42 * mm], mono_first=True)

H2('1.3 How the files fit together')
P('Think of it as layers. Each layer may only reach <i>down</i>. The data file knows nothing about the screen; the '
  'services know the data; analytics knows the services; the pages know everything but only draw; and ' + c('app.js') +
  ' decides <i>when</i> things happen.')
CODE('''
  cockpit.html  ─ the page: structure + placeholders (data-shell, data-el)
       │  loads these scripts, in this order
       ▼
  ┌─ FOUNDATIONS ───────────────────────────────────────────────────────┐
  │  config.js      every number the farm can change: crops, lots, zones │
  │  store.js       safe localStorage / sessionStorage                   │
  │  format.js      ₦, tonnes, dates, "3 days ago"                       │
  │  dom.js         el(), setText(), tag(), badge()…                     │
  │  icons.js       the SVG sprite                                       │
  │  data/prices-snapshot.js   bundled WFP prices (offline fallback)     │
  └──────────────────────────────────────────────────────────────────────┘
       ▼
  ┌─ SERVICES  (compute things; know nothing about the screen) ─────────┐
  │  market.js     prices: WFP via HDX, three tiers, signals             │
  │  weather.js    Open-Meteo forecast, normalised + advisories          │
  │  irrigation.js FAO-56 water balance + the valve controller           │
  │  pests.js      degree days, infection windows, spray window, PHIs    │
  │  livestock.js  herd valuation, heat stress (THI), health calendar    │
  │  harvest.js    maturity windows joined to forecast, price and PHI    │
  │  tasks.js      today's jobs, collapsed out of all of the above       │
  └──────────────────────────────────────────────────────────────────────┘
       ▼
  analytics.js   joins stock to prices: value, margin, spoilage, priority
  charts.js      Chart.js wiring; create once, update in place
  shell.js       builds sidebar, top bar, price board, alerts, footer
  pages/X.js     draws THIS page's sections from a context object
  app.js         boots everything; compute() → render on every change
''')

CALLOUT('why', 'Why script order matters', [
    'Every file ends by attaching something to one shared object: ' + c('NS.fmt = {…}') + ', ' + c('NS.market = {…}') + ', '
    + c('NS.pages.cockpit = {…}') + '. A file can only use what has already been attached, so ' + c('config.js') + ' must load '
    'before ' + c('format.js') + ' (which reads ' + c('cfg.locale') + '), the services before ' + c('analytics.js') + ', and '
    + c('app.js') + ' last of all, because it calls everything. Look at the ' + c('<script>') + ' list at the bottom of any '
    'dashboard page: that list <i>is</i> the dependency graph.',
])

H2('1.4 The render loop in one paragraph')
P('When anything changes; a price arrives, the forecast loads, a valve opens, a treatment is recorded, ' + c('app.js') +
  ' runs ' + c('compute()') + '. That function asks every service for its current answer and packs the results into one '
  '<b>context object</b> (' + c('ctx') + '). Then it hands ' + c('ctx') + ' to the shell (for the sidebar counts and the price '
  'board) and to the page module (for the sections). The page module never fetches or calculates anything; it reads '
  + c('ctx') + ' and writes text into elements. This one-way flow, <i>services → compute → ctx → draw</i>, is the spine '
  'of the whole application, and once you see it, every file makes sense.')

story.append(PageBreak())

# =====================================================================
#  PART 2
# =====================================================================

H1('Part 2, Patterns you will meet in every file')
P('These eight ideas cover most of the code. Learn them here once; the file-by-file section then reads quickly.')

H2('2.1 The namespace and the wrapper function')
P('Every JavaScript file has the same skeleton:')
CODE('''
window.AgroSense = window.AgroSense || {};   // only in config.js, the first file

(function (NS) {
  'use strict';

  var cfg = NS.config;          // read what earlier files attached

  function helper() { … }       // private: nobody outside can see this

  NS.fmt = { money: …, mass: … };   // public: attached to the shared object
})(window.AgroSense);
''')
BUL([
    c('window.AgroSense = window.AgroSense || {};') + ', <i>use the existing object if there is one, otherwise make an empty one</i>. '
    'The ' + c('||') + ' is “or”: if the left side is undefined it falls through to the right. Only the first file needs this line.',
    c('(function (NS) { … })(window.AgroSense);') + '; a function that is defined and immediately called, with the shared object '
    'passed in as ' + c('NS') + '. Everything declared inside is invisible from outside, so files cannot accidentally overwrite '
    'each other’s variables. The pattern is called an <b>IIFE</b> (immediately-invoked function expression).',
    c("'use strict';") + ', asks the browser to be stricter: undeclared variables become errors instead of silently becoming globals.',
    'The last line is the one the rename broke. ' + c('window.AgroSense') + ' is a <i>property name on the window</i>; it has to be the '
    'same spelling in all 20 files.',
])
CALLOUT('try', 'See the shared object', [
    'Open the cockpit, open the console, type ' + c('AgroSense') + ' and press Enter. Expand it. Every key, ' + c('config') + ', '
    + c('fmt') + ', ' + c('market') + ', ' + c('pages') + ', was attached by one file. Type ' + c('AgroSense.market.getQuotes()') +
    ' to see the live price objects. Type ' + c('AgroSense.fmt.money(48215000)') + ' and you get ' + c('₦48,215,000') + '.',
])

H2('2.2 var, function scope, and why not let/const')
P('The code uses ' + c('var') + ' and ' + c('function') + ' declarations everywhere, and no arrow functions, template strings '
  'or classes. This is <b>ES5</b> JavaScript, chosen so the dashboard runs unmodified in older browsers on farm laptops '
  'and phones. If you add new code you may use ' + c('let') + ', ' + c('const') + ' and arrows, modern browsers are fine, '
  'but be consistent within a file. The one thing to remember about ' + c('var') + ': it is scoped to the <i>function</i>, not '
  'the block, so a ' + c('var') + ' inside an ' + c('if') + ' is visible after the ' + c('if') + '.')

H2('2.3 data-el: how JavaScript finds elements')
P('The HTML never uses ' + c('id') + ' for things JavaScript writes into. It uses a data attribute:')
CODE('''
<div class="tile-value" data-el="tileMass">, </div>          <!-- HTML: a placeholder -->

setText(el('tileMass'), fmt.mass(s.totalKg));                 // JS: fill it
''')
P(c('el(name)') + ' in ' + c('dom.js') + ' is just ' + c('document.querySelector(\'[data-el="\' + name + \'"]\')') + '. '
  'The convention keeps the two halves in sync: search the project for ' + c('tileMass') + ' and you find exactly one HTML '
  'placeholder and one JS line that fills it. ' + c('id') + ' is reserved for things that need to be unique for other reasons '
  ',  chart canvases, section anchors that the sidebar links to (' + c('#irrigation') + '), and elements with ' + c('aria-controls') + '.')
CALLOUT('watch', 'A typo in a data-el name fails silently', [
    c('el("tileMas")') + ' returns ' + c('null') + ', and ' + c('setText(null, …)') + ' is written to do nothing rather than crash. '
    'So a misspelt name shows up as a tile stuck on “, ”, not as an error. When that happens, search for the name in both the '
    'HTML and the JS and compare them character by character.',
])

H2('2.4 Build once, update in place')
P('The dashboard redraws often; every price refresh, every irrigation clock tick. If each redraw rebuilt the HTML from a '
  'string, the page would flicker, your text selection would vanish, every chart would be thrown away and recreated, and '
  'a button you were about to click would be replaced under your finger. So the code separates <b>building</b> from '
  '<b>updating</b>:')
CODE('''
function buildLotRows(lots) {        // once: create the <tr>s, keep a handle to each cell
  lots.forEach(function (lot) {
    var tdPrice = tag('td', 'right num');
    …
    lotRows[lot.id] = { price: tdPrice, value: tdValue, … };
  });
}

function updateLotRows(lots) {       // every change: write new text into the same cells
  lots.forEach(function (lot) {
    var r = lotRows[lot.id];
    setText(r.price, fmt.price(lot.price));
  });
}
''')
P(c('setText') + ' itself checks ' + c('node.textContent !== text') + ' before writing, so unchanged cells are not touched at '
  'all. Charts follow the same rule: ' + c('charts.instances[key]') + ' holds each chart, and the second call updates its data '
  'instead of building a new one. Sections that are small and change rarely (advisories, the priority list) do rebuild with '
  + c('innerHTML = \'\'') + '; that is a deliberate trade-off, not an oversight.')

H2('2.5 Publish and subscribe')
P('Services do not know who is listening. Each keeps a list of functions and calls them when something happens:')
CODE('''
var subscribers = [];

function publish(event) {
  subscribers.forEach(function (fn) {
    try { fn(event); } catch (err) { console.error('[market] subscriber failed', err); }
  });
}

subscribe: function (fn) {
  subscribers.push(fn);
  return function unsubscribe() { … };      // the caller can stop listening
}
''')
P(c('app.js') + ' subscribes to ' + c('market') + ', ' + c('irrigation') + ' and ' + c('pests') + ' at boot, and every '
  'subscription ends in a call to ' + c('renderAll()') + ' or ' + c('renderOperations()') + '. The ' + c('try/catch') + ' inside '
  + c('publish') + ' matters: one listener throwing an error must not stop the others from being told.')

H2('2.6 Status objects')
P('Every service exposes a ' + c('status') + ' object and keeps it truthful: ' + c('state') + ' is one of '
  + c('idle | loading | ok | error') + ', with ' + c('lastError') + ', ' + c('lastFetched') + ', ' + c('latencyMs') + ' alongside. '
  'The interface reads status; it never guesses. The “LIVE” pill in the top bar, the footer line “Open-Meteo · HTTP 200 · 412 ms”, '
  'and the market source card are all just status objects rendered as text.')

H2('2.7 fetch, Promises and timeouts')
P('Both APIs are called with ' + c('fetch') + ', which returns a <b>Promise</b>; an object that will have a value later. '
  'You chain ' + c('.then(…)') + ' for the success path and ' + c('.catch(…)') + ' for failure:')
CODE('''
fetchWithTimeout(url, 12000)
  .then(function (res) {
    if (!res.ok) throw new Error('Open-Meteo returned HTTP ' + res.status);
    return res.json();                        // also a Promise
  })
  .then(function (raw) { cache = normalise(raw, location); … })
  .catch(function (err) {
    if (retriesLeft > 0) return attempt(retriesLeft - 1);   // one retry
    status.state = 'error'; status.lastError = err.message;
    throw err;                                 // let the caller know too
  });
''')
P(c('fetchWithTimeout') + ' wraps ' + c('fetch') + ' with an ' + c('AbortController') + ' so a request that hangs is cancelled '
  'after 12 seconds instead of leaving the pill on “Loading” forever. Both services have their own copy of it.')

H2('2.8 Storage that cannot break the page')
P(c('store.js') + ' wraps ' + c('localStorage') + ' (survives closing the browser) and ' + c('sessionStorage') + ' (survives '
  'page-to-page, cleared when the tab closes). Every call is inside ' + c('try/catch') + ' with a fallback value, because storage '
  'can be full, blocked, or missing, and none of that may stop the dashboard rendering. Keys are prefixed ' + c('agrosense.') +
  ' so they never collide with another site on the same host. Who uses it:')
TABLE(['Key', 'Store', 'What it remembers'], [
    ['location', 'local', 'The last location picked in the top bar.'],
    ['prices', 'local', 'The last successful WFP fetch, so the board paints instantly next time.'],
    ['weather', 'session', 'The raw forecast, so moving between pages does not re-query Open-Meteo.'],
    ['irrigation', 'local', 'Running valves, water applied today, the cost ledger, for today only.'],
    ['pests', 'local', 'Treatments and scouting visits recorded in the interface.'],
    ['livestockDone', 'local', 'Health-calendar tasks ticked off.'],
    ['harvestNotified', 'local', 'Which harvest pings were sent today, so each fires once a day.'],
    ['toasted', 'session', 'Which toasts have been shown this session.'],
], widths=[32 * mm, 22 * mm, 116 * mm], mono_first=True)

H2('2.9 Relative dates in the data')
P('Nothing in ' + c('config.js') + ' is a fixed date. Lots have ' + c('harvestedDaysAgo') + ', plantings ' + c('plantedDaysAgo') + ', '
  'health tasks ' + c('dueInDays') + '. Each is turned into a real date at run time (' + c('new Date(now - days * DAY_MS)') + '). '
  'The reason is simple: a demo with fixed dates goes stale the day after it is written. With relative ages the spoilage '
  'maths, the harvest windows and the calendar are correct whenever the dashboard is opened.')

H2('2.10 The severity vocabulary')
P('Every module that judges something uses the same words, and the CSS keys colours off them:')
TABLE(['Level', 'Meaning', 'CSS hook'], [
    ['critical', 'Act now; money is being lost.', '.badge.critical, [data-severity="critical"], [data-level="critical"]'],
    ['serious', 'Act this week.', '.badge.serious, …'],
    ['warning', 'Watch closely.', '.badge.warn / .warning'],
    ['ok / good', 'Under control, or a good opportunity.', '.badge.ok, .badge.good'],
    ['info / neutral', 'Nothing to do.', '.badge.neutral'],
], widths=[26 * mm, 60 * mm, 84 * mm], mono_first=True)
P('Because the words are shared, a page can render an advisory from ' + c('weather.js') + ', a heat-stress row from '
  + c('livestock.js') + ' and a harvest alert from ' + c('harvest.js') + ' with the same badge function and the same colours.')

story.append(PageBreak())

# =====================================================================
#  PART 3
# =====================================================================

H1('Part 3, File by file')
P('In load order. For each file: what it is for, the functions that matter, what it exposes, and what to try.')

# ---------------- config.js
H2('3.1 js/config.js; the data')
EYE('exposes NS.config, NS.SERIES, NS.LIVESTOCK_SERIES')
P('The one file a farm would edit to make the dashboard theirs. It contains no logic; only objects and arrays, and it is '
  'loaded first so everything else can read it as ' + c('cfg') + '. If a number on screen is wrong and it is not a live '
  'price or the weather, it came from here.')
TABLE(['Section', 'What it holds', 'Used by'], [
    ['farm', 'Name, manager, initials, hectares, year established.', 'shell.js (sidebar footer, avatar, greeting)'],
    ['locations', 'Six Nigerian towns with lat/lon. The weather is fetched for whichever is selected.', 'app.js, weather.js, landing.js'],
    ['crops', 'One entry per crop: WFP feed mapping, base price and volatility (for modelled prices), seasonality, shelf life, store, Kc, maturity window, harvest note, colour.', 'market, analytics, irrigation, harvest'],
    ['inventory', 'Lots in store: crop, kg, age in days, cost per kg, grade, field.', 'analytics.js'],
    ['fields', 'The six blocks and what is planted in each.', 'irrigation, pests, farm page'],
    ['plantings', 'What is in the ground: field, crop, days since planting, expected t/ha.', 'harvest.js'],
    ['harvest', 'Lead time for alerts, re-check interval, wet-day threshold.', 'harvest.js, app.js'],
    ['livestock', 'Herds (head, live weight, dressing %, cost, age), products (mapped to WFP series), health calendar, feed cost.', 'livestock.js, market.js'],
    ['irrigation', 'Water cost, depletion trigger, rain effectiveness, demo clock speed, the six zones with soil and root depth.', 'irrigation.js'],
    ['pests', 'Spray limits, the watchlist (insects with base temp + generation DD; diseases with humidity/temp band), treatments on record.', 'pests.js'],
    ['market', 'The HDX endpoint, months of history, minimum markets per month, cache hours, farmgate factor.', 'market.js'],
    ['weather', 'Refresh interval, forecast days, past days, endpoint.', 'weather.js'],
], widths=[26 * mm, 100 * mm, 44 * mm], mono_first=True)
CALLOUT('why', 'Colours are assigned per crop, once', [
    c('SERIES') + ' is a list of six colours in a fixed order, validated so adjacent pairs stay distinguishable to colour-blind '
    'readers. Each crop is given its slot here and keeps it everywhere: the same blue is maize in the pie, the line chart, the '
    'sparkline and the table swatch. A crop must never be coloured by its <i>position</i> in a sorted list, because sorting '
    'would then repaint it. Livestock products have a second, muted list so they never collide with a crop on the same chart.',
])
CALLOUT('try', 'Change the farm', [
    'Add a seventh lot to ' + c('inventory') + ' (copy a line, change the id). Reload the cockpit. The hero value, the “Crops in '
    'store” tile, the sell priority and the lot table on the farm page all change; you did not touch any of them. That is what '
    '“config knows nothing, everything reads config” buys you.',
])

# ---------------- dom.js
H2('3.2 js/dom.js, DOM helpers')
EYE('exposes NS.dom')
TABLE(['Function', 'Does', 'Example'], [
    ['el(name)', 'Find the element whose data-el is name.', "el('tileMass')"],
    ['all(selector)', 'querySelectorAll as a real array.', "all('.nav-link')"],
    ['setText(node, text)', 'Write text only if it changed; ignores a null node.', "setText(el('x'), '42')"],
    ['tag(name, class, text)', 'Create an element with a class and optional text.', "tag('td', 'right num', '1.2 t')"],
    ['icon(id)', 'An <svg><use href="#id"/></svg> from the sprite.', "icon('i-harvest')"],
    ['badge(tone, icon, text)', 'A <span class="badge tone"> with icon and label; the status pattern.', "badge('critical', 'i-alert', 'Act now')"],
    ['flash(node, dir)', 'Add tick-up / tick-down for 900 ms so a moved value glows.', 'flash(cell, 1)'],
    ['deltaClass(v)', "'up' / 'down' / 'flat' for colouring a change.", 'deltaClass(-0.02) → "down"'],
    ['mark(id, color)', 'The product picture for a crop or livestock id, or the plain coloured square if it has none. Every page uses this one call.', "mark(r.cropId, r.color)"],
    ['picture(id, color)', 'A round product picture whose ring is the series colour, replaces the coloured square without losing the legend-to-line link.', "picture('p-maize', '#2a78d6')"],
    ['peek(row, content, into)', 'Hide extra text until the row is hovered, focused or clicked; makes the row focusable.', 'peek(li, p, body)'],
    ['has(name)', 'Is there a data-el called name on this page?', "if (has('heatList')) …"],
], widths=[38 * mm, 78 * mm, 54 * mm], mono_first=True)
P('Notice ' + c('flash') + ' contains ' + c('void node.offsetWidth;') + '. Reading ' + c('offsetWidth') + ' forces the browser to '
  'apply the class removal before the class is added again, without it, two flashes in a row would merge into one. That '
  'line is a well-known trick, and it is the kind of thing worth a comment, which it has.')

# ---------------- store.js
H2('3.3 js/store.js, persistence')
EYE('exposes NS.store.local, NS.store.session')
P('Forty lines, but they protect every page. ' + c('make(storage)') + ' returns an object with ' + c('get') + ', ' + c('set') + ', '
  + c('remove') + '; each wraps the browser call in ' + c('try/catch') + ' and JSON-encodes the value so you can store objects, '
  'not just strings. ' + c('safe(name)') + ' checks whether ' + c('window.localStorage') + ' can even be touched (some private '
  'windows throw on access). If it cannot, a ' + c('noop') + ' object stands in; every ' + c('get') + ' returns the fallback, '
  'every ' + c('set') + ' returns false, and the dashboard carries on without memory.')

# ---------------- format.js
H2('3.4 js/format.js, formatting')
EYE('exposes NS.fmt')
P('All number and date formatting goes through here so the whole site agrees on how a naira amount looks. It uses '
  + c('Intl.NumberFormat') + ', the browser’s built-in locale-aware formatter, configured once for ' + c('en-NG') + ' and '
  + c('NGN') + '.')
TABLE(['Function', 'Input → output'], [
    ['money(n)', '48215000 → ₦48,215,000 (no kobo)'],
    ['price(n)', '852.4 → ₦852.40 (kobo shown, for per-kg prices)'],
    ['moneyShort(n)', '48215000 → ₦48.2m; 12000 → ₦12k'],
    ['moneySigned(n)', '-3200 → -₦3,200; 3200 → +₦3,200'],
    ['mass(kg)', '24000 → 24 t; 640 → 640 kg'],
    ['pct(f), pctSigned(f)', '0.062 → 6.2%; → +6.2%'],
    ['head(n)', '2400 → 2,400 head'],
    ['dayMonth(d), monthYear(d), monthYearLong(d)', '→ 9 Sep; → Jun 26; → June 2026'],
    ['monthToDate("2026-06")', '→ the 15th of June 2026 (WFP dates its months by the 15th)'],
    ['inDays(n)', '0 → today; 1 → tomorrow; -3 → 3 days ago; 5 → in 5 days'],
    ['days(n)', 'shelf life: 4 → 4d left; -2 → 2d over'],
    ['ago(ts)', 'a timestamp → just now / 40s ago / 6m ago / 2h ago'],
], widths=[62 * mm, 108 * mm], mono_first=True)
P('Every function returns ' + c('n/a') + ' for a missing or non-numeric value rather than printing ' + c('NaN') + '. That is why '
  'a page that has not loaded yet shows dashes rather than garbage.')

# ---------------- icons.js
H2('3.5 js/icons.js; the icon sprite')
EYE('exposes NS.icons; injects the sprite into <body>')
P('One SVG containing ~60 ' + c('<symbol>') + 's, each a 24×24 stroked drawing with an id like ' + c('i-harvest') + '. It is '
  'inserted at the top of ' + c('<body>') + ' on load; from then on ' + c('<svg class="icon"><use href="#i-harvest"/></svg>') +
  ' anywhere on the page draws that symbol. Because the strokes use ' + c('currentColor') + ', an icon takes the text colour '
  'of wherever it sits, which is why one sprite works on the dark sidebar and the white cards.')
CALLOUT('try', 'Add an icon', [
    'Copy any ' + c('<symbol>') + ' line in the ' + c('SPRITE') + ' string, give it a new id, and change the ' + c('d="…"') +
    ' path (draw one at a 24×24 grid in any SVG tool, or borrow a path from an open icon set). Then use it with '
    + c("icon('i-yourname')") + ' in JS or ' + c('<use href="#i-yourname"/>') + ' in HTML.',
])

# ---------------- market.js
H2('3.6 js/services/market.js, market prices')
EYE('exposes NS.market')
P('The longest service, because real data is awkward. Prices come from the <b>World Food Programme</b> market monitor, '
  'served through the <b>HDX Humanitarian API</b>; the one free, browser-callable feed of Nigerian food prices. Its shape '
  'dictates the module’s shape:')
BUL([
    'It is <b>monthly</b>, so the board shows the latest complete month and the change on the month before. There is no live tick.',
    'It is <b>retail</b>, at WFP-monitored markets (currently Borno, Yobe and Adamawa). ' + c('config.market.farmgateFactor') + ' lets a farm apply its own spread.',
    'The newest month is usually <b>partial</b>; a few markets in early. A month counts once ' + c('minMarkets') + ' (4) have reported.',
    'Not every crop has a series. Maize flour stands in for maize grain (a <b>proxy</b>); cassava and soybean have nothing and are <b>modelled</b>. The board labels each one.',
])
H3('Instruments')
P(c('instruments()') + ' merges the crops and the livestock products into one list, each tagged ' + c('kind: "crop"') + ' or '
  + c('"livestock"') + '. From here on the module does not care which is which; an instrument is anything with a price.')
H3('Three tiers')
CODE('''
  init()
    │
    ├─ loadCache()     localStorage "prices"  ← the last live fetch
    ├─ loadSnapshot()  data/prices-snapshot.js ← bundled by tools/fetch-prices.py
    │      pick whichever is newer → apply() → publish('snapshot')      [page paints NOW]
    │
    └─ if not fresh (older than cacheHours): refresh()
           fetchCommodity() for every WFP commodity in parallel
           ↓ settle()  (Promise.allSettled for old browsers)
           merge with what we had, store.local.set('prices'), apply(), publish('update')
''')
P('The order is the point: the page paints with real figures from the offline tier <i>before</i> any request is answered, '
  'and the live fetch quietly upgrades it. If the fetch fails, the status carries the error and the offline figures stay up.')
H3('From raw rows to a quote')
TABLE(['Function', 'What it does'], [
    ['compactSeries(rows, commodity)', 'Groups raw API rows by month, keeps one price per market, takes the median across markets, converts to the base unit (2.1 KG → per kg). Returns {points:[{m, p, n}], unit, states…} where n is how many markets reported.'],
    ['latestCompleteMonth(series)', 'The newest month where any series has n ≥ minMarkets. This becomes the end of the shared month axis.'],
    ['monthAxis(end, 24)', 'The last 24 month keys, oldest first; every instrument is laid on this same axis so they can be summed.'],
    ['liveHistory(inst, compact)', 'Maps the axis to closes. A month with no complete data carries the previous month forward and is marked filled:true; a flat segment rather than a hole.'],
    ['modelledHistory(inst)', 'For instruments with no series: a mean-reverting random walk around basePrice × seasonalFactor, seeded deterministically so it is the same every reload.'],
    ['rebuild()', 'Runs the above for every instrument, counts live/proxy/modelled, records which states reported, then calls rebuildQuote for each.'],
    ['deriveSignal(price, ma12, momentum)', 'Sell now / Sell soon / Hold / Watch, by comparing this month with the 12-month average (see Part 5).'],
    ['rebuildQuote(id)', 'Builds the quote object every page reads: price, prevClose, changePct, ma3, ma12, yoy, spark (last 12), signal, mode, a plain-English note on provenance.'],
], widths=[52 * mm, 118 * mm], mono_first=True)
CALLOUT('why', 'Why fill forward instead of leaving a gap', [
    'The portfolio history multiplies every month’s price by the kilos held. A ' + c('null') + ' in one crop’s series would make '
    'the whole farm value ' + c('null') + ' for that month; a hole in the hero chart. Carrying the last known price forward '
    'and flagging it ' + c('filled: true') + ' keeps the sum honest and lets the interface say “no new data this month”.',
])
CALLOUT('try', 'Watch the tiers', [
    'Open the live page and the console. ' + c('AgroSense.market.status.tier') + ' says ' + c('"snapshot"') + ', ' + c('"cache"') +
    ' or ' + c('"live"') + '. Clear the cache with ' + c("localStorage.removeItem('agrosense.prices')") + ', reload, and watch it go '
    'snapshot → live. Open the Network tab, filter “hapi”, and you will see one request per commodity.',
])

# ---------------- weather.js
H2('3.7 js/services/weather.js, weather intelligence')
EYE('exposes NS.weather')
P('Live data from <b>Open-Meteo</b> for the selected location. No API key, no sign-up. The request asks for far more than '
  'temperature: soil moisture and soil temperature, reference evapotranspiration (ET<sub>0</sub>), precipitation probability, '
  'wind, because the irrigation, pest and livestock models all run off this one response. It also asks for '
  + c('past_days=14') + ': the irrigation deficit is accumulated <i>backwards</i> from the last watering, and degree days are '
  'summed over the weeks a pest has been developing.')
TABLE(['Function', 'What it does'], [
    ['buildUrl(location)', 'Assembles the query string from CURRENT_FIELDS, HOURLY_FIELDS, DAILY_FIELDS and the location.'],
    ['interpret(code)', 'Turns a WMO weather code (0–99) into a label and an icon name.'],
    ['normalise(raw, location)', 'The important one. Converts the API’s parallel arrays into one tidy object: current, daily (from today, 7 days), pastDaily (the 14 days before), hourlyWindow (72 rows from now), soil, next48 (rain total, max probability, humid hours).'],
    ['deriveAdvisories(w)', 'Seven rules that turn the forecast into things to do: heavy rain → hold fertiliser; dry + low soil moisture → irrigate; humid + warm → scout for disease; wind → do not spray; heat; a dry run → drying window. Each states the number it fired on.'],
    ['load(location)', 'fetch with a 12 s timeout and one retry; on success normalise, cache in memory and sessionStorage.'],
    ['restore(location)', 'On page load: if a forecast for this location is in sessionStorage and younger than refreshMs, re-normalise it instead of fetching.'],
], widths=[46 * mm, 124 * mm], mono_first=True)
CALLOUT('watch', 'Index 0 is not today', [
    'With ' + c('past_days') + ' in the request, the daily arrays start two weeks back. ' + c('normalise') + ' finds today by '
    'comparing ISO date strings, not by assuming index 0. Likewise the hourly arrays include hours already past, so '
    + c('startIdx') + ' is the first hour at or after now and every “next 48 hours” slice starts there. If you add a new '
    'hourly field, slice it through the same ' + c('slice()') + ' helper.',
])

# ---------------- irrigation.js
H2('3.8 js/services/irrigation.js, irrigation control')
EYE('exposes NS.irrigation')
P('Two jobs. The <b>water balance</b> answers “how thirsty is each zone?” with the FAO-56 method (Part 5.6). The '
  '<b>controller</b> lets valves be opened and closed, and a running valve genuinely changes the numbers.')
TABLE(['Function', 'What it does'], [
    ['accumulateDeficit(zone, crop, weather)', 'Walks forward from the last watering day: each day add ETc (ET0 × Kc), subtract effective rain (× 0.75), floor at zero. Uses the real past days; falls back to a regional ET0 and flags estimated:true if the forecast is down. Subtracts water applied this session.'],
    ['rainRelief(weather, balance)', 'Will the next three days’ rain cover the deficit? Returns forecastMm, effectiveMm, covers, helps.'],
    ['recommend(zone, crop, balance, relief)', 'The state: Rain-fed / Rain expected (only if a run was actually due) / Irrigate now (deficit ≥ RAW) / Due soon (≥ 75% of RAW) / Holding. Plus run time, volume and cost to close the gap.'],
    ['computeZones(weather), summarise(zones)', 'One row per zone with all of the above; totals for the tiles.'],
    ['start(zoneId, minutes), stop(zoneId), stopAll(), startAllDue()', 'The controls. start() refuses a rain-fed zone or one already running.'],
    ['advance(seconds)', 'The clock. Every second, each open run gains seconds × simulationSpeed of run time; mm applied = rate × hours; volume = mm × ha × 10; cost = volume × ₦/m³. Finished runs close themselves.'],
    ['persist() / restore()', 'The whole controller state lives in localStorage for the day. A run left open on one page is caught up on the time that passed when the next page opens.'],
], widths=[56 * mm, 114 * mm], mono_first=True)
CALLOUT('why', 'The demo clock is stated, not hidden', [
    'A 210-minute run at real speed would never be watched. ' + c('simulationSpeed: 60') + ' makes one real second one minute of '
    'run time, and the zones card prints exactly that. The alternative, completing a run instantly, would make the water '
    'and cost figures meaningless. Honest acceleration beats a fake result.',
])

# ---------------- pests.js
H2('3.9 js/services/pests.js, pest and disease control')
EYE('exposes NS.pests')
P('Three models on the same forecast, and one rule that reaches back into the money.')
TABLE(['Function', 'What it does'], [
    ['degreeDays(pest, weather)', 'Insects. Sums max(0, (Tmax+Tmin)/2 − baseTemp) over the past days since the last scouting visit, starting from ddAtLastScout, then projects the forecast forward. Returns the running series (for the chart), progress toward generationDD, and days to the crossing.'],
    ['infectionWindow(pest, weather)', 'Diseases. The longest unbroken run of hours inside the humidity/temperature band in the next 48 h, against wetHoursTrigger. Progress is capped at 1, “200% of an infection window” is not a thing.'],
    ['sprayWindow(weather)', 'The next run of ≥ 2 hours under maxWindKmh, under maxPrecipProb, under maxTempC. No window → the treatment button is disabled.'],
    ['treatmentRows(), getFieldConstraints()', 'Treatments on record (config + session), each with days remaining on its pre-harvest interval. getFieldConstraints() returns {field: {daysRemaining, reason, detail, clearsOn}} for every block still inside a PHI.'],
    ['assess(weather)', 'Everything above for every pest, ranked by level then progress, with the spray window, the treatment list and summary counts.'],
    ['treat(pestId), scout(pestId)', 'The actions. treat() records a treatment on every field growing that crop and starts the PHI clock; scout() clears the overdue flag. Both persist and publish.'],
], widths=[50 * mm, 120 * mm], mono_first=True)
CALLOUT('why', 'getFieldConstraints() is a contract', [
    'It returns plain data; a field, a number of days, a reason. ' + c('analytics.js') + ' and ' + c('harvest.js') + ' read it '
    'without knowing what a pesticide is. That is how a spray recorded on the operations page can strand a cassava lot on the '
    'farm page and rewrite the sell priority on the cockpit: the constraint travels as data through ' + c('compute()') + '.',
])

# ---------------- harvest.js
H2('3.10 js/services/harvest.js, harvest alerts')
EYE('exposes NS.harvest')
P('Every planting has a window: the crop’s ' + c('maturityDays') + ' [earliest, latest] counted from planting. '
  + c('statusFor(daysToOpen, daysToClose)') + ' places a block in one of five tiers, overdue, ready, imminent (≤ 7 days), '
  'approaching (≤ leadDays), growing. Then three joins decide whether “ready” means “today”:')
BUL([
    c('weatherWindow()') + ', is the opening day wet (≥ 8 mm)? Where is the first pair of dry days?',
    c('marketNote()') + ', is the price worth selling off the field, or should this crop go into store and wait?',
    'The PHI from ' + c('constraints') + '; a spray that clears <i>after</i> the window opens holds the harvest back.',
])
P(c('assess()') + ' returns rows, alerts (anything not growing), livestock coming to market weight, and a summary. '
  + c('notify()') + ' sends browser notifications for critical/serious alerts, once a day per block, tracked in localStorage. '
  + c('requestPermission()') + ' is only called from a button, browsers ignore permission requests that a user did not trigger.')

# ---------------- livestock.js
H2('3.11 js/services/livestock.js, livestock')
EYE('exposes NS.livestock')
TABLE(['Function', 'What it does'], [
    ['valueHerds(quotes)', 'Head × live kg × dressing % = carcass kg, priced at the live meat price. Layers are held at book value (they are an income stream, not a carcass) and their eggs priced per day. Also feed cost per day and days to market weight.'],
    ['holdings()', 'Carcass kg per product plus the layers’ book value, what portfolioHistory needs to value the herd at each month’s price.'],
    ['thi(temp, rh)', 'Temperature-humidity index: 0.8T + (RH/100)(T − 14.4) + 46.4.'],
    ['heatStress(weather)', 'For each herd, the peak THI in the next 48 h (air temperature for fish) against species-specific bands, hours above the mild threshold, and species-specific relief advice.'],
    ['deriveAdvisories(weather)', 'Moderate/severe heat stress as an advisory in the same shape weather.js uses, so the cockpit lists it alongside the field advisories.'],
    ['health(), markDone(id), reopen(id)', 'The vaccination/treatment calendar with due-date levels; completion is stored in localStorage.'],
], widths=[46 * mm, 124 * mm], mono_first=True)

# ---------------- analytics.js
H2('3.12 js/analytics.js, inventory analytics')
EYE('exposes NS.analytics')
P('Where stock meets price. Everything the dashboard claims about money is computed here from three inputs: the lots in '
  + c('config.inventory') + ', the quotes from ' + c('market') + ', and the clock.')
TABLE(['Function', 'What it does'], [
    ['spoilage(daysRemaining)', 'A coarse flag: past window → 100% of value exposed; ≤ 2 days → 50%; ≤ 5 → 25%; ≤ 10 → 10%; else 0.'],
    ['valueLots(quotes, constraints)', 'One enriched row per lot: market value (kg × price), cost value, margin, days in store, shelf life left, risk, value at risk, and, if the lot’s field is under a PHI, blocked / blockedFor / stranded (blocked for longer than it will keep).'],
    ['byCrop(lots)', 'Rolls lots up to one row per crop, what the pie and bar chart show. Keeps the worst risk and soonest expiry.'],
    ['summary(lots, crops)', 'Totals: value, cost, margin, kg, value at risk, blocked value, sellable value, stranded value, top crop and its share.'],
    ['portfolioHistory(months)', 'Today’s holdings (crop kg + carcass kg + layer book value) valued at each of the last 24 months’ prices. Holdings are held constant on purpose, see the box.'],
    ['sellPriority(crops)', 'The ranking (Part 5.4). A PHI overrides both forces; a stranded lot goes to the top with “Will spoil before it can be sold”.'],
    ['snapshot(quotes, constraints)', 'Runs all of the above plus livestock.value() and merges the totals into farmValue / farmCost / farmMargin.'],
], widths=[46 * mm, 124 * mm], mono_first=True)
CALLOUT('why', 'The history chart holds the barn constant', [
    'The hero chart answers “what have prices done to the value of what I am holding?”. If it also tracked when each lot '
    'arrived, a price fall would look like a sale and a harvest would look like a rally. Fixing the holdings isolates the '
    'price effect, which is the thing a farmer cannot see any other way. The label under the chart says exactly this.',
])

# ---------------- charts.js
H2('3.13 js/charts.js; the chart layer')
EYE('exposes NS.charts')
P('All Chart.js configuration in one place. Two rules shape it. First, <b>charts are created once and updated in place</b>, '
  'each function checks ' + c('instances[key]') + ' and, if the chart exists, swaps its data and calls ' + c('update(\'none\')') +
  '. Second, <b>no chart has two y-axes</b>: where two measures have different scales (temperature and rainfall) they get two '
  'charts, because a dual axis invents a relationship the data does not contain.')
P('Colours are read from the stylesheet at boot by ' + c('loadTokens()') + ' (' + c('getComputedStyle(document.documentElement).getPropertyValue(\'--chart-grid\')') +
  '), so the palette has one source of truth in ' + c('styles.css') + '.')
TABLE(['Chart', 'Type', 'Where'], [
    ['portfolioValue', 'Single-series area line, 24 months, with an end-label plugin', 'Cockpit hero'],
    ['marketTrend', 'One line per instrument, 12 or 24 months, legend toggles', 'Live page (crops; livestock)'],
    ['inventoryMix', 'Doughnut of value by crop (≤ 6 segments), 2 px surface gaps', 'Farm page (crops; herds)'],
    ['valueVsCost', 'Grouped horizontal bars: market value vs cost per crop', 'Farm page'],
    ['forecastTemp / forecastRain', 'Two charts, one axis each: high/low lines; rainfall bars', 'Live page'],
    ['waterDeficit', 'Grouped horizontal bars: deficit vs refill point per zone', 'Operations'],
    ['degreeDays', 'Measured (solid) + forecast (dashed) accumulation vs a threshold line', 'Operations'],
    ['sparkline', 'Raw canvas, no Chart.js, twelve of these redraw on every update', 'Live page tables'],
], widths=[38 * mm, 92 * mm, 40 * mm], mono_first=True)

# ---------------- shell.js
H2('3.14 js/shell.js; the shared chrome')
EYE('exposes NS.shell')
P('Each dashboard page carries four empty placeholders, ' + c('<div data-shell="sidebar">') + ', ' + c('topbar') + ', '
  + c('board') + ', ' + c('footer') + '. ' + c('shell.build()') + ' replaces each with real markup, so the sidebar is written once '
  'in JavaScript rather than four times in HTML. The ' + c('NAV') + ' array at the top is the sidebar’s content: four entries, '
  'one per page, each with an ' + c('href') + ', an icon and (optionally) the name of a count pill. ' + c('data-page') + ' on ' + c('<body>') +
  ' tells the shell which group is current.')
TABLE(['Function', 'What it does'], [
    ['buildSidebar / buildTopbar / buildBoard / buildFooter', 'Create the chrome. The top bar includes the location select, the live pill, the alerts bell (and its hidden panel), refresh, and the avatar.'],
    ['bindDrawer()', 'The hamburger, which does two jobs: on a narrow screen (≤ 860 px) it opens the sidebar as a drawer over the page; on a wide one it collapses the sidebar column and remembers the choice in localStorage (sidebarCollapsed). Escape closes the drawer; a nav tap closes it too.'],
    ['buildBoardCells / updateBoard', 'The price rail: one cell per instrument, grouped crops / livestock, with a WFP / proxy / modelled tag and a flash on change.'],
    ['setCount(name, value, alert)', 'The count pills. Hidden at zero; a “0” is not news. app.js sets one per page: cockpit (urgent advisories + harvest), operations (zones due or running + pests), farm (harvest alerts + heat + health).'],
    ['renderAlerts(assessment)', 'The bell panel: harvest and livestock alerts, plus the notification-permission button.'],
    ['buildFooter()', 'The page foot. Only the words “Data sources” show; the three provenance lines are always in the DOM (app.js keeps them current) and lift up in a dark card on hover or focus.'],
    ['toast(opts)', 'A bottom-right toast that removes itself after 9 s.'],
    ['enhanceInfo() / attachInfo()', 'Moves every section description and every static chart caption behind a small “i” beside its heading, served by ONE shared popover. Hover or keyboard focus opens it, a click pins it (the touch route), Escape or an outside click closes it. Captions with a data-el carry live figures and are left visible.'],
], widths=[56 * mm, 114 * mm], mono_first=True)

# ---------------- app.js
H2('3.15 js/app.js; the orchestrator')
EYE('exposes NS.app')
P('The file that knows <i>when</i>. It has no drawing code of its own.')
TABLE(['Function', 'What it does'], [
    ['compute()', 'Asks every service for its answer and packs one ctx object: quotes, weather, snapshot, history, advisories (weather + livestock, sorted by severity), irrigation, pests, harvest, heat, health, constraints.'],
    ['chrome(ctx)', 'Updates the board, every sidebar count, the alerts panel, the sources footer and the live pill.'],
    ['renderAll()', 'compute → chrome → pageModule.render(ctx). The heavy path.'],
    ['renderOperations()', 'compute → the two operations counts → pageModule.renderOperations(ctx). The light path, used by the irrigation clock so the whole page is not rebuilt every second.'],
    ['loadWeather()', 'weather.load → renderAll → pingHarvest, whether or not it succeeded (the error is kept in state).'],
    ['pingHarvest()', 'Browser notifications via harvest.notify, and in-app toasts once per session for urgent items.'],
    ['bindChrome()', 'The location select (saved to localStorage) and the refresh button (weather + prices).'],
    ['boot()', 'The startup sequence, see Part 4.1.'],
], widths=[38 * mm, 132 * mm], mono_first=True)

# ---------------- pages
CALLOUT('why', 'Two ways of tucking text away, for two kinds of text', [
    '<b>Explanation</b>, what a section is for, how to read a chart, sits behind the “i” (' + c('attachInfo') + '). It is the same '
    'for every visitor and every refresh, so it is lifted out of the HTML once, at load.',
    '<b>Reasoning about one row</b>, why cassava is ranked second, how far a block is through its window, opens when that row is '
    'hovered (' + c('dom.peek') + '). It is generated per row from live data, so it is built where the row is built.',
    'The reveal animates ' + c('grid-template-rows') + ' from ' + c('0fr') + ' to ' + c('1fr') + '; the one CSS trick that animates to '
    'an height you do not know in advance. Both patterns keep the text in the DOM, so screen readers still reach it.',
])

H2('3.16 js/pages/*.js; the page modules')
P('Each registers ' + c('NS.pages.<name>') + ' with up to three functions. ' + c('init()') + ' runs once before any data: it '
  'builds static rows and binds buttons. ' + c('render(ctx)') + ' runs on every change and only reads ' + c('ctx') + '. '
  + c('renderOperations(ctx)') + ' (operations page only) is the cheap per-second path.')
TABLE(['Module', 'init()', 'render(ctx) fills'], [
    ['cockpit.js', 'Starts the clock in the conditions card.', 'The whole cockpit grid, conditions and the seven days ahead, six tiles, the market feed, what the farm is worth, today\u2019s jobs, then the sell priority, advisories and harvest calendar below it.'],
    ['live.js', 'Builds the crop and livestock table rows and legends; binds the 12/24-month range buttons.', 'The seven-day temperature and rainfall charts, both market tables and trend charts, the provenance card.'],
    ['operations.js', 'Binds “Open all due zones” / “Close all”; the pest select.', 'Irrigation tiles, deficit chart, zone cards with valve buttons and progress bars; pest tiles, degree-day chart, treatments, watchlist with Record treatment / Log scouting.'],
    ['farm.js', 'Binds the sortable column headers.', 'Lot table (built once, updated in place) + footer, mix and value-vs-cost charts, field tiles, harvest calendar with window timelines, herd table, heat stress, health calendar.'],
], widths=[28 * mm, 60 * mm, 82 * mm], mono_first=True)
CALLOUT('try', 'Follow one number from data to screen', [
    'Pick the “Livestock on the hoof” tile. In ' + c('cockpit.html') + ' find ' + c('data-el="tileStock"') + '. In '
    + c('pages/cockpit.js') + ' find ' + c("setText(el('tileStock'), …)") + '; it reads ' + c('ctx.snapshot.livestock.summary.totalValue') +
    '. In ' + c('app.js') + ', ' + c('compute()') + ' got ' + c('snapshot') + ' from ' + c('analytics.snapshot()') + ', which called '
    + c('NS.livestock.value(quotes)') + '. In ' + c('livestock.js') + ', ' + c('valueHerds') + ' multiplied head × kg × dressing × price. '
    'The price came from ' + c('market.js') + ', the head count from ' + c('config.js') + '. Five files, one direction.',
])

# ---------------- landing
H2('3.17 js/landing.js and index.html; the landing page')
P('Deliberately standalone: it loads only ' + c('config.js') + ', the price snapshot and itself, so it is fast and cannot break '
  'if a dashboard file does. It makes one small Open-Meteo request for the default location, reads one clean series '
  '(rice) from the bundled snapshot, and finds the soonest harvest from ' + c('config.plantings') + '. If the weather request '
  'fails the chips say so rather than showing stale numbers. “Log in” is a link.')

# ---------------- css
H2('3.18 css/styles.css; the dashboard stylesheet')
P('About 1,600 lines, organised top to bottom in the order things appear on screen. The section banners (' + c('/* === Shell === */') +
  ') are the map, search for them.')
H3('Tokens first')
P('Lines 22–120 define every colour, radius and font as a <b>CSS custom property</b> on ' + c(':root') + ': '
  + c('--canopy-600: #28a95e;') + '. Everywhere else says ' + c('var(--canopy-600)') + '. Change the token and every use changes; '
  'this is also how ' + c('charts.js') + ' gets its colours; it reads them at boot with ' + c('getComputedStyle') + '. That is why '
  'the whole interface could be re-skinned without touching a single chart file.')

H3('The tonal ladder; the one idea the look is built on')
P('There are no borders and no shadows anywhere. Depth is carried by <b>tone</b>, and the ladder runs the opposite way to most '
  'interfaces: surfaces get <i>lighter</i> as you go deeper.')
CODE('''
  --backdrop      #d8d9db    the desk the app panel sits on
  --shell         #e3e3e3    the app panel itself
  --surface       #f2f2f2    a card on the panel
  --surface-sunk  #f9f9f9    a row INSIDE a card, lighter, not darker
  --surface-lift  #ffffff    the brightest step: inputs, hover, chips
''')
P('So a card reads as a card because it is a step lighter than the panel, and a row reads as nested because it is a step '
  'lighter again. Add a border and the effect collapses, which is why ' + c('--hairline') + ' is almost invisible and every '
  'card sets ' + c('border: 0') + ' explicitly.')
P('On top of that sit exactly three accents: one saturated green (' + c('--canopy-600: #28a95e') + ') for the single headline '
  'tile, the weather card and every chart line; near-black (' + c('--soil-900: #121212') + ') for the price board, the active '
  'rail chip and count badges; and the reserved status four (good / warning / serious / critical) which never carry anything '
  'but state. Everything else on the screen is grey.')
H3('The shell, for reference')
TABLE(['Lines', 'What'], [
    ['172–180', '.shell; the rounded panel: a flex row, full height, overflow hidden'],
    ['182–193', '.sidebar; the 84px icon rail and its width transition'],
    ['195–231', '.brand, .brand-mark, .brand-text; the green disc; the wordmark is drawer-only'],
    ['242–262', '.nav-link; the 52×52 chip, hover, and .is-active (black)'],
    ['264–281', '.nav-count; the badge on the chip corner, with a shell-coloured ring'],
    ['282–309', '.sidebar-foot and .nav-logout'],
    ['311–323', '.main and the desktop collapse (body.sidebar-collapsed sets the rail to width 0)'],
    ['325–345', '.topbar; a fixed header row, no longer sticky'],
    ['433–470', '.board; the black price rail'],
    ['518–535', '.content; the ONLY scrolling element on the page'],
    ['548–560', '.card; a lighter step, radius 20, no border, no shadow'],
    ['650–686', '.tile and .tile-accent; the stat tiles and the one green headline tile'],
    ['1586– (@media 860px)', 'Where the rail becomes a labelled drawer'],
])

H3('The app-shell layout')
P('The page itself does not scroll. ' + c('body') + ' is ' + c('height: 100dvh; overflow: hidden') + ' with a little padding, '
  'the ' + c('.shell') + ' panel fills it, and inside the panel only ' + c('.content') + ' scrolls. That is what keeps the top '
  'bar and the price board permanently in view and gives the app its "one panel" feel.')
CODE('''
  body        100dvh, overflow hidden, padding: var(--inset)   ← the backdrop
    .shell    height 100%, radius 26px, overflow hidden, flex row
      .sidebar   84px rail, flex: none
      .main      flex column, overflow hidden
        .topbar  flex: none
        .board   flex: none
        .content flex: 1, overflow-y: auto      ← the scroller
''')
P('One consequence worth knowing: ' + c('window.scrollTo') + ' and ' + c('document.documentElement.scrollTop') + ' do nothing '
  'now. If you need to scroll the page from JavaScript, scroll ' + c("document.querySelector('.content')") + ' instead. '
  + c('scrollIntoView()') + ' still works, because it finds the right scroll container on its own.')
H3('Specificity in one example')
CODE('''
.nav-link .nav-count          { background: rgba(255,255,255,0.12); }   /* two classes   */
.nav-link .nav-count.is-alert { background: var(--critical); }          /* three classes */
''')
P('Both rules match an alert pill. The second wins because it is <i>more specific</i> (three class names beat two), not '
  'because it comes later, although later does break ties. When a style “does not apply”, this is the first thing to check; '
  'DevTools strikes through the losing property.')
H3('Responsive')
P('Four breakpoints near the bottom: ' + c('1180px') + ' (tiles 4→2), ' + c('980px') + ' (two-column grids → one), '
  + c('860px') + ' (the sidebar becomes a drawer), ' + c('620px') + ' (tiles → 1, controls stack). A ' + c('prefers-reduced-motion') +
  ' block turns off the entrance animation for people who have asked their OS for that.')
CALLOUT('fix', 'overflow: hidden does not clip position: absolute', [
    'The panel clips its contents with ' + c('overflow: hidden') + ', yet jumping to ' + c('live.html#market') + ' once scrolled the '
    '<i>whole window</i> and left the panel cut off. The cause: an absolutely-positioned element is only clipped by an ancestor that is '
    'itself <b>positioned</b>. The visually-hidden text spans (' + c('.sr-only') + ', which the info buttons add all the way down the page) '
    'were absolute with no positioned ancestor, so they escaped the panel and stretched the document to 2,056 px against an 808 px window.',
    '<b>The fix</b> was two lines: ' + c('position: relative') + ' on ' + c('.shell') + ' and ' + c('.content') + '. Test for it with '
    + c('document.documentElement.scrollHeight') + ', in an app-shell layout it must equal ' + c('innerHeight') + ', and any bigger number '
    'means something has escaped.',
])

CALLOUT('watch', 'The ladder is only four steps wide, do not invent a fifth', [
    'Every surface in the interface is one of ' + c('--shell') + ', ' + c('--surface') + ', ' + c('--surface-sunk') + ' or '
    + c('--surface-lift') + ', and they sit within about twenty levels of each other. Drop in a hand-picked grey like '
    + c('#eaeaea') + ' and it will read as a mistake rather than a layer, because it lands between two steps.',
    'The same restraint applies to the accent. One green tile per screen is the rule; two and neither reads as the headline. '
    'The green tile on the cockpit is marked with the class ' + c('tile-accent') + ' in ' + c('cockpit.html') + ', move the '
    'class to change which number leads.',
])

H2('3.19 css/landing.css')
P('A separate, smaller sheet for ' + c('index.html') + ' only: the full-bleed photograph and its shade, the grid overlay, the '
  'telemetry chips, and the entrance animation. It shares the token names with ' + c('styles.css') + ' so the two look like one product.')

H2('3.20 The HTML pages')
P('Every dashboard page has the same skeleton, and only the middle differs:')
CODE('''
<body data-page="cockpit">                    ← which nav group is current
  <div class="shell">
    <div data-shell="sidebar"></div>          ← shell.js replaces these four
    <div class="main" id="main">
      <div data-shell="topbar"></div>
      <div data-shell="board"></div>
      <div class="content">
        <section class="section" id="overview">   ← id matches the nav hash
          … cards with data-el placeholders …
        </section>
      </div>
      <div data-shell="footer"></div>
    </div>
  </div>
  <script src="…Chart.js…"></script>
  <script src="js/config.js"></script>          ← then the rest, in dependency order
  …
  <script src="js/pages/cockpit.js"></script>
  <script src="js/app.js"></script>             ← always last
</body>
''')
P('Section ' + c('id') + 's are the sidebar’s anchors, so renaming one breaks a link. ' + c('aria-labelledby') + ', '
  + c('.sr-only') + ' headings and ' + c('<caption>') + 's on tables are there for screen readers; keep them when you copy a block.')

H2('3.21 tools/fetch-prices.py and data/prices-snapshot.js')
P('The snapshot is the offline tier for prices. The Python script calls the same HDX endpoint the browser does, does the same '
  'median-across-markets reduction, and writes a compact JavaScript file. Run it whenever you want fresher bundled data:')
CODE('''
python tools/fetch-prices.py       # writes data/prices-snapshot.js; no packages needed
''')
P('The generated file must not be edited by hand; it says so at the top. The browser will overwrite its own cached copy '
  'anyway on the next successful fetch.')

H2('3.22 js/services/tasks.js, today\u2019s jobs')
EYE('exposes NS.tasks')
P('The task list on the cockpit is not a separate to-do app. It is the rest of the dashboard collapsed into one ranked list '
  'of things a person could go and do this morning, and every row carries the reason the service that produced it gave:')
TABLE(['Row', 'Comes from', 'Fires when'], [
    ['Harvest a block', 'harvest.js', 'the block is inside or past its window and the level is critical or serious'],
    ['Irrigate a zone', 'irrigation.js', 'the deficit has passed the refill point and the zone has a valve'],
    ['Treat a pest', 'pests.js', 'the threshold is crossed AND a spray window is open'],
    ['Scout a block', 'pests.js', 'not walked in over ten days, unless that pest is already queued for treatment, since spraying means visiting'],
    ['Vaccinate a herd', 'livestock.js', 'the health calendar has it due inside three days'],
    ['Move the stock', 'analytics.js', 'the top of the sell priority scores 0.55 or more'],
], widths=[36 * mm, 30 * mm, 104 * mm], mono_first=False)
P('Ticking a row stores the completion for the rest of the day under ' + c('agrosense.tasksDone') + ', keyed by date so '
  'yesterday\u2019s ticks do not carry over. The one exception is a livestock health row, which calls '
  + c('livestock.markDone()') + ' instead; the farm page owns those, and the two views have to agree.')
CALLOUT('why', 'Why the list is derived rather than stored', [
    'Nothing is ever added to this list by hand. If a task is on it, some model put it there and can be argued with; if the '
    'weather changes and a spray window closes, the "treat" row disappears on the next render. A to-do list you maintain '
    'separately goes stale the first busy week. One that is recomputed from the forecast and the barn cannot.',
])

story.append(PageBreak())

# =====================================================================
#  PART 4
# =====================================================================

H1('Part 4, Walkthroughs')
P('Trace these with the console open. Each step names the function; put a ' + c('console.log') + ' in it if you want to '
  'see it fire.')

H2('4.1 Opening cockpit.html')
steps = [
    'The browser parses the HTML. The four ' + c('data-shell') + ' placeholders and every ' + c('data-el') + ' element exist but are empty.',
    'Scripts load in order. ' + c('config.js') + ' creates ' + c('window.AgroSense') + '. Each following file attaches its part. ' + c('icons.js') + ' injects the sprite. ' + c('pests.js') + ' and ' + c('irrigation.js') + ' restore their localStorage state as they load.',
    c('app.js') + ' runs ' + c('boot()') + ' when the DOM is ready.',
    c('boot') + ' reads the saved location (or the default), then ' + c('charts.init()') + ' reads the CSS tokens.',
    c('shell.build()') + ' replaces the placeholders with the sidebar, top bar, board and footer; binds the drawer and the bell; builds the board cells (still showing “, ”).',
    c('bindChrome()') + ' fills the location select and wires the refresh button.',
    'The page module’s ' + c('init()') + ' runs (the cockpit has none; the farm page builds its table rows here).',
    c('app') + ' subscribes to ' + c('market') + ', then calls ' + c('market.init()') + '. That loads the cache or snapshot and publishes <b>synchronously</b>, so the subscriber fires immediately and ' + c('renderAll()') + ' paints real prices before any network request exists.',
    'Inside ' + c('renderAll') + ': ' + c('compute()') + ' builds ' + c('ctx') + ' (with ' + c('weather: null') + ' for now), ' + c('chrome(ctx)') + ' fills the board and counts, ' + c('pages.cockpit.render(ctx)') + ' fills the hero and tiles. Weather-dependent sections say “Waiting on the forecast…”.',
    'If the price cache is stale, ' + c('market.refresh()') + ' starts in the background.',
    c('app') + ' subscribes to ' + c('irrigation') + ' and starts its one-second clock; subscribes to ' + c('pests') + '.',
    c('weather.restore()') + ' is tried. On the first page of a session it returns null, so ' + c('loadWeather()') + ' runs: the pill goes to “Loading”, ' + c('weather.load()') + ' fetches Open-Meteo.',
    'The forecast arrives (~400 ms). ' + c('normalise') + ' shapes it, it is cached in sessionStorage, ' + c('renderAll()') + ' runs again, now advisories, irrigation, pests, harvest and heat stress all have data, and ' + c('pingHarvest()') + ' shows toasts for anything urgent.',
    'Some time later the WFP fetch returns; ' + c('market') + ' publishes ' + c('update') + '; ' + c('renderAll()') + ' runs a third time and the board cells flash where a price moved.',
    'From here: the irrigation clock ticks every second (only doing work if a valve is open); weather re-checks every minute and re-fetches after 15 minutes; the harvest check re-runs hourly; the tab going hidden pauses the clock.',
]
for i, s in enumerate(steps, 1):
    story.append(Paragraph('<b>%d.</b>  %s' % (i, s), S['bullet']))
SP(6)

H2('4.2 Clicking “Record treatment” on cassava mealybug')
steps = [
    'In ' + c('pages/operations.js') + ' the button’s click handler opens a ' + c('confirm()') + ' dialog naming the product, the fields and the PHI.',
    'On OK it calls ' + c('NS.pests.treat(\'mealybug\')') + '. That finds every field growing cassava (Field C), pushes a treatment record with ' + c('appliedAt: Date.now()') + ' and ' + c('phiDays: 3') + ' into ' + c('sessionTreatments') + ', persists to localStorage, and publishes.',
    c('app.js') + '’s pest subscription calls ' + c('renderAll()') + '.',
    c('compute()') + ' calls ' + c('NS.pests.getFieldConstraints()') + ', which now includes ' + c('{ "Field C": { daysRemaining: 3, … } }') + '.',
    c('analytics.snapshot(quotes, constraints)') + ' runs ' + c('valueLots') + '. Both cassava lots are from Field C, so both get ' + c('blocked: true') + '. LOT-2427 has 1 day of shelf life left and is blocked for 3, so ' + c('stranded: true') + ' and its whole value becomes ' + c('strandedValue') + '.',
    c('byCrop') + ' rolls that up; ' + c('sellPriority') + ' sees ' + c('row.strandedValue > 0') + ' and returns the “Will spoil before it can be sold” item with score 1.2, above everything else.',
    c('harvest.assess') + ' also receives the constraints: the cassava planting in Field C gains a ' + c('phi') + ' note if the interval clears after its window opens.',
    'Every page then redraws from the new ' + c('ctx') + ': the cockpit’s sell priority puts cassava first with a “Sale blocked” badge; the farm page’s lot table shades the two rows; the operations page lists the new treatment with “3d to clear”; the sidebar counts update.',
    'Reload the page: ' + c('pests.js') + ' restores the treatment from localStorage on load, so the block survives. To undo it, clear the key: ' + c("localStorage.removeItem('agrosense.pests')") + '.',
]
for i, s in enumerate(steps, 1):
    story.append(Paragraph('<b>%d.</b>  %s' % (i, s), S['bullet']))
SP(6)

H2('4.3 Changing the location')
steps = [
    'The ' + c('<select>') + ' fires ' + c('change') + '. ' + c('bindChrome') + '’s handler finds the location object, stores its id in localStorage, and calls ' + c('loadWeather()') + '.',
    c('weather.load(location)') + ' fetches Open-Meteo for the new coordinates. The session cache is replaced.',
    c('renderAll()') + ' → ' + c('compute()') + '. Nothing about prices or stock changed, but every forecast-driven model re-runs: advisories, the irrigation deficits (a drier town → larger deficits), infection windows, the spray window, heat stress, the harvest weather join.',
    'Try Ibadan then Kano and watch the irrigation zones go from “Holding” to “Due soon”, and rice blast from critical to clear.',
]
for i, s in enumerate(steps, 1):
    story.append(Paragraph('<b>%d.</b>  %s' % (i, s), S['bullet']))
SP(6)

H2('4.4 Opening a valve')
steps = [
    '“Open valve” calls ' + c('NS.irrigation.start(zoneId, minutes)') + ' with the minutes ' + c('recommend()') + ' computed to close the deficit. A run object is created and persisted; ' + c('publish(\'started\')') + ' fires.',
    c('app.js') + '’s irrigation subscription calls ' + c('renderOperations()') + '; the light path, which redraws the zone cards and the two sidebar counts only.',
    'Every second ' + c('loop()') + ' → ' + c('advance(1)') + ': the run gains 60 minutes of run time, mm applied = rate × 1 h, the ledger grows, ' + c('persist()') + ', ' + c('publish(\'progress\')') + ' → the progress bar moves.',
    'When ' + c('elapsedMinutes') + ' reaches the plan, the run is deleted and ' + c('publish(\'completed\')') + ' fires. Next ' + c('computeZones') + ' subtracts the applied mm from the deficit, so the zone reads “Holding”.',
    'Navigate to another page mid-run: ' + c('restore()') + ' on the next page reads the saved run, sees how many real seconds passed, and calls ' + c('advance(gap)') + ' to catch up.',
]
for i, s in enumerate(steps, 1):
    story.append(Paragraph('<b>%d.</b>  %s' % (i, s), S['bullet']))

story.append(PageBreak())

# =====================================================================
#  PART 5
# =====================================================================

H1('Part 5; The maths, with worked examples')
P('Every number on screen comes from one of these. The examples use the figures in ' + c('config.js') + ' and a plausible '
  'price, so you can check them against the dashboard.')

H2('5.1 What a lot is worth')
CODE('''
marketValue = quantityKg × price          LOT-2411: 24,000 kg × ₦880.95 = ₦21,142,800
costValue   = quantityKg × costPerKg      24,000 × ₦610 = ₦14,640,000
margin      = marketValue − costValue     ₦6,502,800   (+44% over cost)
''')
P('The farm value on the cockpit is the sum of every lot’s market value plus the livestock value (5.9). '
  '“Margin over cost” is the same sum against the same lots’ cost.')

H2('5.2 Spoilage and value at risk')
CODE('''
daysRemaining = shelfLifeDays − harvestedDaysAgo
LOT-2427 cassava: 7 − 6 = 1 day left   → spoilage factor 0.50 (≤ 2 days: "Move immediately")
valueAtRisk   = marketValue × factor   → 22,400 kg × ₦562.71 × 0.50 = ₦6,302,352
''')
P('The tile “Value at spoilage risk” sums ' + c('valueAtRisk') + ' over every lot. It is deliberately coarse; a farmer wants '
  'a flag, not a decimal.')

H2('5.3 The price signal')
CODE('''
ratio = thisMonth / average of last 12 months
ratio ≥ 1.10 and rose last month  → Sell now
ratio ≥ 1.04                      → Sell soon
ratio ≤ 0.94                      → Hold  (selling here locks in the dip)
otherwise                         → Watch
''')
P('It is a <i>position</i>, not a prediction: is this month strong or weak against the crop’s own recent history?')

H2('5.4 Sell priority')
CODE('''
spoilUrgency  = clamp(1 − soonestExpiry / 30, 0, 1)     30+ days out → 0; today → 1
marketUrgency = { sell: 1, soon: 0.7, watch: 0.4, hold: 0.1 }[signal]
score         = 0.55 × spoilUrgency + 0.45 × marketUrgency

Cassava: 1 day left → spoil 0.97; signal "hold" → 0.1     score = 0.58
Maize:  206 days left → spoil 0;   signal "soon" → 0.7    score = 0.32
''')
P('Spoilage is weighted slightly higher because a rotten tuber has no price at all. A pre-harvest interval overrides the '
  'score entirely: blocked → score × 0.1; blocked <i>and</i> stranded → 1.2, above every ordinary item.')

H2('5.5 Farm value over time')
CODE('''
for each of the last 24 months m:
  value[m] = Σ (kg held of crop c today × price[c][m])        crops in store
           + Σ (carcass kg of product p × price[p][m])       herds
           + layers' book value                              constant
''')
P('Holdings are today’s, held constant; only prices move. So the curve is “what would my current barn and herd have '
  'fetched each month?”; the price effect alone.')

H2('5.6 Irrigation: the FAO-56 water balance')
CODE('''
TAW     = awcMmPerM × rootDepthM              ZN-A: 120 × 0.60 = 72 mm   (soil's usable water)
RAW     = TAW × depletionTrigger              72 × 0.5 = 36 mm            (what the crop draws comfortably)
ETc     = ET0 × Kc                            4.2 × 1.20 = 5.0 mm/day     (maize's daily use)
each day since the last watering:
  deficit = max(0, deficit + ETc − rain × 0.75)

5 dry days:            deficit = 5 × 5.0 = 25 mm  → 69% of RAW → "Due soon"
5 days with 6 mm rain: 5 × (5.0 − 4.5) = 2.5 mm    → "Holding"
to close a 25 mm deficit on 26 ha at 8 mm/h:
  run time = 25 / 8 = 3.1 h;  volume = 25 × 26 × 10 = 6,500 m³;  cost = 6,500 × ₦165 = ₦1.07m
''')
P('ET<sub>0</sub> and rainfall are the real past days from Open-Meteo. That is why the same zones read “Holding” at Ibadan '
  'in the rainy season and “Due soon” at Kano.')

H2('5.7 Pests: growing degree days')
CODE('''
GDD(day) = max(0, (Tmax + Tmin) / 2 − baseTemp)
Yam beetle: base 14 °C, generation at 450 DD, 210 DD at the last scout 15 days ago
a 30/23 °C day: (30 + 23)/2 − 14 = 12.5 DD
15 such days: 210 + 15 × 12.5 = 397.5 DD  → 88% → "Treat this week"
days to crossing = (450 − 397.5) / 12.5 ≈ 4
''')
P('Development runs on warmth, not the calendar, which is why the model needs the past days and why a warm week '
  'brings the next generation forward.')

H2('5.8 Diseases: infection windows')
CODE('''
count the LONGEST UNBROKEN run of hours in the next 48 where
  humidity ≥ minRh  and  tempRange[0] ≤ temp ≤ tempRange[1]
Tomato late blight: ≥ 85% RH at 10–26 °C, trigger 8 hours
16 consecutive humid hours → window met → critical.  Progress is capped at 1.
''')
P('Scattered humid hours do not infect a crop; consecutive ones do. Hence the longest run, not the total.')

H2('5.9 Livestock: carcass value and eggs')
CODE('''
carcassKg   = head × avgLiveKg × dressing       cattle: 42 × 310 × 0.52 = 6,770 kg
marketValue = carcassKg × meat price            6,770 × ₦6,800 = ₦46.0m
layers:      marketValue = head × costPerHead (book)   2,400 × ₦4,200 = ₦10.1m
             eggs/day = head × layRate = 2,400 × 0.82 = 1,968; income = 1,968 × ₦220 = ₦433k/day
feed/day    = head × feedCostPerHeadDay[species]
''')

H2('5.10 Heat stress: the temperature–humidity index')
CODE('''
THI = 0.8 × T + (RH / 100) × (T − 14.4) + 46.4
32 °C at 70% RH: 25.6 + 0.7 × 17.6 + 46.4 = 84.3
cattle bands: mild 68, moderate 72, severe 80  → severe
goat bands:   mild 74, moderate 80, severe 86  → moderate (a Dwarf goat minds it less)
''')

story.append(PageBreak())

# =====================================================================
#  PART 6, glossary
# =====================================================================

H1('Part 6, Glossary')
H2('JavaScript and browser terms as used here')
TABLE(['Term', 'Meaning'], [
    ['IIFE', 'Immediately-invoked function expression: (function(){ … })();; a private scope that runs once.'],
    ['Namespace', 'The one shared object, window.AgroSense, that every file attaches to.'],
    ['DOM', 'The browser’s live tree of elements. JavaScript changes the page by changing the DOM.'],
    ['data-* attribute', 'A custom HTML attribute (data-el, data-shell, data-page). Read in JS via dataset or querySelector.'],
    ['Promise / .then / .catch', 'A value that arrives later; chain what to do on success and failure.'],
    ['fetch', 'The browser’s HTTP request function; returns a Promise of a Response.'],
    ['AbortController', 'Lets a fetch be cancelled, used for the 12 s / 45 s timeouts.'],
    ['localStorage / sessionStorage', 'Per-site key–value storage; local survives restarts, session lasts one tab.'],
    ['Notification', 'The browser notification API, harvest pings, only after the user grants permission.'],
    ['CSS custom property', 'A variable in CSS: --canopy-800, read with var(--canopy-800).'],
    ['Specificity', 'Which CSS rule wins when several match: more ids > more classes > more elements; ties go to the later rule.'],
    ['Media query', '@media (max-width: 860px) { … }, rules that apply only at some screen sizes.'],
    ['Canvas', 'A bitmap element you draw on with JavaScript; Chart.js and the sparklines use it.'],
    ['pub/sub', 'Publish–subscribe: a service calls every registered listener when something happens.'],
], widths=[40 * mm, 130 * mm], mono_first=True)
H2('Farming terms')
TABLE(['Term', 'Meaning'], [
    ['Farmgate price', 'What the farmer receives at the farm, before transport and market margins. WFP publishes retail; farmgateFactor adjusts.'],
    ['Lot', 'A batch of harvested produce in store, tracked as one unit.'],
    ['Shelf life', 'How long a crop holds condition in its store, 7 days for fresh cassava, 300 for soybean in a silo.'],
    ['Pre-harvest interval (PHI)', 'Days after applying a pesticide before the crop may legally be harvested/sold.'],
    ['ET0 / ETc', 'Reference evapotranspiration (what a standard grass surface loses to the air) and crop evapotranspiration (ET0 × the crop coefficient Kc).'],
    ['TAW / RAW', 'Total and readily available water in the root zone, FAO-56 terms.'],
    ['Growing degree days', 'Accumulated warmth above a base temperature; insects develop on it.'],
    ['Dressing percentage', 'Carcass weight as a share of live weight, 52% for cattle, 72% for broilers.'],
    ['THI', 'Temperature–humidity index, the standard measure of heat stress in livestock.'],
    ['Scouting', 'Walking a field to look for pests and disease; the models count days since the last visit.'],
], widths=[40 * mm, 130 * mm])

story.append(PageBreak())

# =====================================================================
#  PART 7, study plan
# =====================================================================

H1('Part 7; A study plan for two')
P('Five sessions of about two hours. Alternate who drives; the other reads this guide aloud and asks “why?”.')
TABLE(['Session', 'Read', 'Do'], [
    ['1 · The map', 'Parts 1 and 2. Fix the rename bug first.', 'Run the site. In the console, explore AgroSense. Find one data-el in HTML and its setText in JS. Change a config number and watch it propagate.'],
    ['2 · Data in', '3.6 market, 3.7 weather, 4.3.', 'Network tab: find the HDX and Open-Meteo requests, read the JSON. Break the weather URL on purpose (edit endpoint) and watch the error state. Put it back.'],
    ['3 · The joins', '3.12 analytics, 3.9 pests, 3.10 harvest, 4.2, 5.1–5.5.', 'Record a treatment and follow the chain across three pages. Check one lot’s value by hand against the table. Change a shelf life and see the priority reorder.'],
    ['4 · Operations & livestock', '3.8, 3.11, 4.4, 5.6–5.10.', 'Open a valve; switch location to Kano; verify the deficit maths for one zone by hand. Tick a health task; find the localStorage key it wrote.'],
    ['5 · Drawing', '3.13 charts, 3.14 shell, 3.16 pages, 3.18 CSS.', 'Add a sixth tile to the cockpit (HTML + one setText). Change the sidebar palette. Add an icon to the sprite and use it. Make .tile:hover lift.'],
], widths=[30 * mm, 52 * mm, 88 * mm])

H2('Exercises, easiest first')
BUL([
    '<b>Rename a nav item.</b> In ' + c('shell.js') + ', change “The cockpit” to “Overview” in the NAV array. One string.',
    '<b>Add a location.</b> Add your town to ' + c('config.locations') + ' with its coordinates. It appears in the select.',
    '<b>Add a crop.</b> A seventh crop needs a colour (extend ' + c('SERIES') + ', but note the pie’s six-segment guidance), a config entry, at least one lot, a field, a planting and a pest. Watch what breaks when you leave one out.',
    '<b>A new advisory rule.</b> In ' + c('weather.deriveAdvisories') + ', add “frost risk” when ' + c('tempMin < 5') + '. Give it a severity, an icon and a window.',
    '<b>A new tile.</b> “Feed cost per day” on the cockpit from ' + c('ctx.snapshot.livestock.summary.feedPerDay') + '.',
    '<b>Sort the market table.</b> Copy the ' + c('bindSorting') + ' pattern from ' + c('farm.js') + ' to ' + c('live.js') + '.',
    '<b>A dark theme.</b> Add a second set of token values under ' + c('[data-theme="dark"]') + ' and a toggle that sets the attribute and remembers it in ' + c('store.local') + '. Then fix the charts: ' + c('charts.init()') + ' reads tokens once, so it needs re-running.',
    '<b>Replace the modelled prices.</b> Find a second price source for cassava and add it as a fourth tier in ' + c('market.js') + '. Keep the provenance honest.',
])

story.append(PageBreak())

# =====================================================================
#  APPENDICES
# =====================================================================

H1('Appendix A, Where to change what')
TABLE(['I want to…', 'Edit', 'Notes'], [
    ['Change the brand name', 'shell.js line 68 (sidebar); <title> in each HTML; index.html', 'Never the last line of a JS file.'],
    ['Change the farm name / hectares', 'config.farm', 'Shows in the sidebar footer and greeting.'],
    ['Change a price’s source', 'config.crops[x].feed / livestock.products[x].feed', 'null = modelled; add proxy text if a related series stands in.'],
    ['Change the panel or card tone', 'styles.css :root, --shell, --surface, --surface-sunk', 'Keep the steps evenly spaced or the layering stops reading.'],
    ['Change the count pills', 'styles.css 264–281', 'Black by default; the ring is what separates them from the active chip.'],
    ['Change the top bar', 'styles.css 325–345', 'It is a flex row inside the panel, not a sticky bar.'],
    ['Add a page', 'a new HTML file + a page module + a NAV entry in shell.js', 'data-page on <body> must match the NAV id.'],
    ['Add a stat tile', 'HTML .tile with two data-el names + setText lines in the page module', 'See 3.16 “Follow one number”.'],
    ['Change the demo irrigation speed', 'config.irrigation.simulationSpeed', 'The zones card prints the figure.'],
    ['Change how often weather refreshes', 'config.weather.refreshMs', 'Also the sessionStorage freshness window.'],
    ['Refresh the bundled prices', 'python tools/fetch-prices.py', 'Do not edit the output file by hand.'],
    ['Add an icon', 'icons.js SPRITE', 'Then icon("i-name") or <use href="#i-name">.'],
    ['Change a chart’s colours', 'styles.css tokens (--series-*, --chart-grid, --canopy-600)', 'charts.js reads them at boot with getComputedStyle.'],
], widths=[44 * mm, 66 * mm, 60 * mm])

H1('Appendix B, Debugging checklist')
BUL([
    '<b>A page is blank or stuck on “, ”.</b> Console first. A red <i>SyntaxError</i> means a file did not parse, nothing after it ran. ' + c('node --check <file>') + ' finds it without a browser.',
    '<b>One tile is stuck on “, ”.</b> A ' + c('data-el') + ' name differs between HTML and JS. Search both.',
    '<b>A style does not apply.</b> Elements tab → select the element → Styles. The winning rule is on top; losers are struck through. Check specificity (3.18) and that the media query matches your width.',
    '<b>The weather is “offline”.</b> Network tab → filter “open-meteo” → click the request → Response. HTTP 400 means a bad parameter; failed means no internet or a blocked host.',
    '<b>Prices are all “modelled”.</b> ' + c('AgroSense.market.status') + ' in the console: ' + c('tier') + ', ' + c('lastError') + '. If HDX is down the snapshot should still load, check ' + c('data/prices-snapshot.js') + ' is in the script list.',
    '<b>Something changed and will not go back.</b> It is in storage: ' + c('Object.keys(localStorage)') + ' lists the ' + c('agrosense.*') + ' keys; ' + c('localStorage.clear()') + ' resets the lot.',
    '<b>A number looks wrong.</b> Find the formula in Part 5, compute it by hand from ' + c('config.js') + ' and the quote, and compare. Then put a ' + c('console.log') + ' at the line that computes it.',
    '<b>The drawer will not open.</b> Only dashboard pages have it, and only under 860 px wide. Check the console for an error earlier in ' + c('shell.build()') + '.',
])

# ---------------------------------------------------------------- build

OUT.parent.mkdir(parents=True, exist_ok=True)
doc = Guide(str(OUT))
doc.multiBuild(story)
print('wrote', OUT, '(%d KB)' % (OUT.stat().st_size // 1024))
