// Strings of the project poster (one slide per project) and the supervisor's posters folder. Merged by i18n.js.
const COLLEGES_EN = { hadith: 'Hadith', quran: 'Holy Quran', sharia: 'Sharia', law: 'Regulations (Law)', arabic: 'Arabic Language', aqeedah: 'Aqeedah & Dawah',
  engineering: 'Engineering', computer: 'Computer & IS', business: 'Business', science: 'Science', other: 'Other' };
const COLLEGES_AR = { hadith: 'الحديث الشريف', quran: 'القرآن الكريم', sharia: 'الشريعة', law: 'الأنظمة', arabic: 'اللغة العربية', aqeedah: 'العقيدة والدعوة',
  engineering: 'الهندسة', computer: 'الحاسب الآلي', business: 'الأعمال', science: 'العلوم', other: 'أخرى' };
const pre = (o, p) => Object.fromEntries(Object.entries(o).map(([k, v]) => [p + k, v]));

export const EXTRA = {
  en: {
    'nav.poster': 'Project poster', 'nav.posters': 'Posters folder',
    'po.title': 'Project poster', 'po.sub': 'Fill in your project page as in the course template — the slide is built for you and placed in your supervisor\'s posters folder.',
    'po.project': 'Project', 'po.download': 'Download the slide (.pptx)', 'po.sec.identity': 'Project name and audience', 'po.sec.shots': 'Screenshots',
    'po.f.name_ar': 'Project name (Arabic)', 'po.f.name_en': 'Project name (English)', 'po.f.audience': 'Target audience', 'po.f.description': 'Project description',
    'po.f.colleges': 'Target colleges', 'po.f.other': 'Other college (shown instead of "Other")', 'po.f.url': 'Project link', 'po.f.desktop': 'Desktop screenshot', 'po.f.mobile': 'Mobile screenshot',
    'po.audiencePh': 'e.g. Individuals, students, staff', 'po.audienceHint': 'One or two words — it appears in the "Target audience" box.',
    'po.descPh': 'One paragraph of 60–110 words: the problem the project solves, the proposed solution, the main features and the goal.',
    'po.words': '{n} words (aim for 60–110)', 'po.useDesc': 'Use the research description',
    'po.collegesHint': 'Pick one or more. Selected colleges are highlighted on the slide.', 'po.urlHint': 'The QR code on the slide is generated from this link.',
    'po.noShot': 'No screenshot yet', 'po.hint.desktop': 'PNG or JPG, landscape (e.g. 1440×900), up to 5 MB.', 'po.hint.mobile': 'PNG or JPG, portrait (e.g. 390×844), up to 5 MB.',
    'po.removeShot': 'Remove', 'po.tooBig': 'The picture exceeds 5 MB', 'po.save': 'Save poster', 'po.saved': 'Poster saved', 'po.savedDone': 'Poster complete — it is now in the posters folder',
    'po.status': 'Poster status', 'po.doneOf': '{a} of {b} items done', 'po.updated': 'Last update', 'po.inFolder': 'Complete: your supervisor gets it in the posters folder.',
    'po.notInFolder': 'Your supervisor sees it as incomplete until every item is filled in.', 'po.team': 'Team on the slide', 'po.teamHint': 'Names and university IDs come from the team in the system.',
    'po.teamCut': '{n} more member(s) do not fit on the slide', 'po.noResearch': 'No research yet', 'po.noResearchD': 'Register a research topic first; then fill in its poster here.',
    'po.st.complete': 'Complete', 'po.st.partial': 'In progress', 'po.st.empty': 'Not started',
    'po.folder': 'Posters folder', 'po.folderSub': 'Every project of the course with its poster. Download one slide, or all complete posters as one presentation.',
    'po.dlAll': 'Download all started', 'po.dlDone': 'Download complete ({n})', 'po.missing': 'Missing', 'po.slide': 'Slide', 'po.noCourse': 'No projects yet',
    'po.noProjects': 'No projects in this course yet', 'po.fileName': 'Project posters - {c}',
    'n.poster.done': '{who} completed the poster of "{title}"',
    ...pre(COLLEGES_EN, 'po.c.'),
  },
  ar: {
    'nav.poster': 'ملصق المشروع', 'nav.posters': 'مجلد الملصقات',
    'po.title': 'ملصق المشروع', 'po.sub': 'عبّئ صفحة مشروعك كما في قالب المقرر — تُبنى الشريحة تلقائيًا وتُحفظ في مجلد الملصقات لدى المشرف.',
    'po.project': 'المشروع', 'po.download': 'تحميل الشريحة (.pptx)', 'po.sec.identity': 'اسم المشروع والفئة المستهدفة', 'po.sec.shots': 'لقطات الشاشة',
    'po.f.name_ar': 'اسم المشروع (عربي)', 'po.f.name_en': 'اسم المشروع (إنجليزي)', 'po.f.audience': 'الفئة المستهدفة', 'po.f.description': 'وصف المشروع',
    'po.f.colleges': 'الكلية المستهدفة', 'po.f.other': 'اسم الكلية الأخرى (يظهر بدل «أخرى»)', 'po.f.url': 'رابط المشروع', 'po.f.desktop': 'لقطة سطح المكتب', 'po.f.mobile': 'لقطة الجوال',
    'po.audiencePh': 'مثال: الأفراد، الطلاب، الموظفون', 'po.audienceHint': 'كلمة أو كلمتان — تظهر في مربع «المستهدفون».',
    'po.descPh': 'فقرة واحدة بين 60 و110 كلمة: ما المشكلة التي يحلها المشروع، وما الحل المقترح، وأهم المزايا والخصائص، والهدف الذي يسعى إليه.',
    'po.words': '{n} كلمة (المطلوب بين 60 و110)', 'po.useDesc': 'استخدم وصف البحث',
    'po.collegesHint': 'اختر كلية أو أكثر، وتظهر الكليات المختارة مميزة في الشريحة.', 'po.urlHint': 'يُولَّد رمز QR في الشريحة من هذا الرابط.',
    'po.noShot': 'لا توجد لقطة بعد', 'po.hint.desktop': 'PNG أو JPG بالعرض (مثل 1440×900)، حتى 5 ميجابايت.', 'po.hint.mobile': 'PNG أو JPG بالطول (مثل 390×844)، حتى 5 ميجابايت.',
    'po.removeShot': 'إزالة', 'po.tooBig': 'حجم الصورة أكبر من 5 ميجابايت', 'po.save': 'حفظ الملصق', 'po.saved': 'تم حفظ الملصق', 'po.savedDone': 'اكتمل الملصق — أصبح في مجلد الملصقات',
    'po.status': 'حالة الملصق', 'po.doneOf': 'اكتمل {a} من {b}', 'po.updated': 'آخر تحديث', 'po.inFolder': 'مكتمل: يجده المشرف في مجلد الملصقات.',
    'po.notInFolder': 'يظهر للمشرف كغير مكتمل حتى تُعبّأ جميع العناصر.', 'po.team': 'فريق العمل في الشريحة', 'po.teamHint': 'الأسماء والأرقام الجامعية تؤخذ من الفريق المسجل في النظام.',
    'po.teamCut': '{n} من الأعضاء لا تتسع لهم الشريحة', 'po.noResearch': 'لا يوجد بحث بعد', 'po.noResearchD': 'سجّل موضوع البحث أولًا، ثم عبّئ ملصقه هنا.',
    'po.st.complete': 'مكتمل', 'po.st.partial': 'قيد التعبئة', 'po.st.empty': 'لم يبدأ',
    'po.folder': 'مجلد الملصقات', 'po.folderSub': 'كل مشاريع المقرر مع ملصقاتها. حمّل شريحة مشروع واحد، أو كل الملصقات المكتملة في عرض واحد.',
    'po.dlAll': 'تحميل كل ما بدأ', 'po.dlDone': 'تحميل المكتملة ({n})', 'po.missing': 'الناقص', 'po.slide': 'الشريحة', 'po.noCourse': 'لا توجد مشاريع بعد',
    'po.noProjects': 'لا توجد مشاريع في هذا المقرر بعد', 'po.fileName': 'ملصقات المشاريع - {c}',
    'n.poster.done': 'أكمل {who} ملصق مشروع «{title}»',
    ...pre(COLLEGES_AR, 'po.c.'),
  },
};
export const ERR_EXTRA = {
  'Only the project team can edit its poster': 'تعبئة الملصق لفريق المشروع فقط',
  'Only the owner can edit the poster': 'تعبئة الملصق لصاحب المشروع فقط',
  'Only the team leader can edit the poster': 'يعبّئ قائد الفريق الملصق (يمكنه السماح للأعضاء من صفحة الفريق)',
  'This research was rejected': 'تم رفض هذا البحث',
  'The project description must be at most 160 words': 'وصف المشروع يجب ألا يتجاوز 160 كلمة',
  'The project link must be a web address (https://…)': 'رابط المشروع يجب أن يكون عنوان موقع (https://…)',
  'Choose target colleges from the list': 'اختر الكليات المستهدفة من القائمة',
  'No project has completed its poster yet': 'لم يُكمل أي مشروع ملصقه بعد',
  'No project has filled in its poster yet': 'لم يبدأ أي مشروع بتعبئة ملصقه بعد',
};
export const ERR_EXTRA_PATTERNS = [
  [/^Poster field (\w+) is too long \(max (\d+) chars\)$/, m => `الحقل طويل جدًا (الحد ${m[2]} حرفًا)`],
];
