# ربط المشروع بـ Supabase / Connecting the app to Supabase

<div dir="rtl">

## ما الذي تغيّر؟
- **قاعدة البيانات:** صارت PostgreSQL على Supabase بدلاً من ملف SQLite محلي.
- **الملفات المرفوعة** (ملفات البحث والمراحل ومرفقات الرسائل): صارت تُحفظ في Supabase Storage، في حاوية (bucket) خاصة اسمها `uploads`.
- **تسجيل الدخول:** بقي كما هو (الرقم الجامعي للطلاب والبريد للموظفين)، ولم نستخدم Supabase Auth.
- **الفائدة:** البيانات لا تضيع بعد الآن عند إعادة تشغيل الخادم، حتى على خطة Render المجانية.
- **بدون Supabase:** إذا لم تضع إعدادات Supabase، يعمل التطبيق كما كان على جهازك، بقاعدة بيانات مدمجة (PGlite) داخل مجلد `data/`. هذا مناسب للتجربة فقط.

لا تحتاج إلى إنشاء أي جدول أو حاوية بيدك. التطبيق ينشئ كل شيء تلقائياً عند أول تشغيل.

## الخطوة 1: إنشاء مشروع Supabase
1. ادخل إلى https://supabase.com وأنشئ حساباً مجانياً (يمكنك الدخول بحساب GitHub).
2. اضغط **New project**.
3. اكتب اسماً للمشروع، مثل `research-pms`.
4. اكتب **Database Password** قوية **واحفظها**، فستحتاجها في الخطوة 2.
5. اختر **Region** قريبة منك، ويُفضّل أن تكون نفس منطقة الخادم (مثلاً Frankfurt لكليهما).
6. انتظر دقيقة أو اثنتين حتى يجهز المشروع.

## الخطوة 2: نسخ رابط قاعدة البيانات (`DATABASE_URL`)
1. داخل المشروع، اضغط زر **Connect** في أعلى الصفحة.
2. من قائمة Connection string اختر **Session pooler**. هذا النوع يعمل مع Render ومع أي شبكة IPv4.
3. انسخ الرابط. سيكون بهذا الشكل:
   `postgresql://postgres.abcd...:[YOUR-PASSWORD]@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`
4. استبدل `[YOUR-PASSWORD]` بكلمة مرور قاعدة البيانات من الخطوة 1، واحذف الأقواس `[ ]`.

> إذا كانت كلمة المرور تحتوي رموزاً مثل `@` أو `#` أو `/`، فاختر كلمة مرور أخرى من حروف وأرقام فقط، فهذا أسهل.

## الخطوة 3: نسخ رابط المشروع والمفتاح السري
1. من القائمة الجانبية افتح **Project Settings**.
2. في صفحة **Data API** (أو **General**)، انسخ **Project URL**، مثل `https://abcd....supabase.co`. هذا هو `SUPABASE_URL`.
3. في صفحة **API Keys**، انسخ **Secret key** (يبدأ بـ `sb_secret_`). إذا لم تجده، فانسخ مفتاح **service_role** من تبويب Legacy. هذا هو `SUPABASE_SERVICE_ROLE_KEY`.

> ⚠️ المفتاح السري يعطي صلاحية كاملة على المشروع:
> - ضعه فقط في إعدادات الخادم (Render) أو في ملف `.env`.
> - لا ترفعه إلى GitHub.
> - لا ترسله لأحد.

## الخطوة 4أ: التشغيل على جهازك مع Supabase
1. انسخ الملف `.env.example` إلى ملف جديد اسمه `.env` في نفس مجلد المشروع.
2. املأ فيه القيم التي نسختها في الخطوتين 2 و3.
3. شغّل التطبيق:
   - على Windows: افتح `start-app.bat`.
   - أو من الطرفية: `npm install` ثم `npm start`.
4. تأكد أن رسالة التشغيل تقول: `database: PostgreSQL / Supabase, files: Supabase Storage`.

في ملف `.env.example` القيمة `NODE_ENV=production` مفعّلة. معناها:
- لا تُنشأ حسابات تجريبية.
- يُنشأ حساب مدير واحد: البريد `ADMIN_EMAIL` (الافتراضي `admin@example.com`) وكلمة المرور `ADMIN_PASSWORD`.

إذا حذفت السطر `NODE_ENV=production`، تُضاف الحسابات التجريبية (`admin123` و`doctor123`…) إلى قاعدة Supabase الحقيقية. لا تفعل ذلك إلا لقاعدة تجريبية.

## الخطوة 4ب: النشر على Render (مجاناً)
1. في Render اختر **New + → Blueprint**.
2. اختر هذا المستودع. الملف `render.yaml` جاهز.
3. املأ المتغيرات التي يطلبها Render:

| المتغير | القيمة |
|---|---|
| `ADMIN_PASSWORD` | كلمة مرور المدير (8 أحرف أو أكثر) |
| `DATABASE_URL` | الرابط من الخطوة 2 |
| `SUPABASE_URL` | رابط المشروع من الخطوة 3 |
| `SUPABASE_SERVICE_ROLE_KEY` | المفتاح السري من الخطوة 3 |

4. اضغط **Apply**. بعد انتهاء النشر:
   1. ادخل بحساب المدير.
   2. أنشئ حسابات الدكاترة من تبويب **Users**.
   3. أضف الأرقام الجامعية المعتمدة للطلاب من تبويب **Approved IDs**.

## الخطوة 5: التأكد أن كل شيء يعمل
- في Supabase، افتح **Table Editor**. ستجد الجداول (`users`, `research`, `stages`…) بعد أول تشغيل.
- افتح **Storage**. ستجد حاوية خاصة (Private) اسمها `uploads`، وفيها الملفات بعد أول رفع.
- الجداول محمية بـ Row Level Security. لا يمكن قراءتها بالمفتاح العام (anon)، والخادم وحده يصل إليها.

## ملاحظات مهمة
- **حدود الخطة المجانية:**
  - قاعدة بيانات بحجم 500MB.
  - تخزين ملفات بحجم 1GB.
  - هذا يكفي لمقرر جامعي.
- **التوقف المؤقت:** يتوقف مشروع Supabase المجاني تلقائياً إذا لم يُستخدم أسبوعاً كاملاً. لإعادة تشغيله اضغط **Restore** من لوحة Supabase.
- **النسخ الاحتياطي:** من **Database → Backups**. يمكنك أيضاً تصدير جدول من Table Editor.
- **تصفير البيانات والبدء من جديد:**
  1. افتح **SQL Editor** ونفّذ الأمر التالي:
     ```sql
     DO $$ DECLARE t text; BEGIN
       FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
         EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', t);
       END LOOP;
     END $$;
     ```
  2. أفرغ حاوية `uploads` من صفحة Storage.
  3. أعد تشغيل التطبيق، فيُنشأ حساب المدير من جديد.
- **البيانات القديمة:** البيانات الموجودة في ملف SQLite القديم (`data/app.db`) لا تُنقل تلقائياً.

</div>

---

## English summary
| Variable | Where to find it | Used for |
|---|---|---|
| `DATABASE_URL` | Supabase → **Connect** → *Session pooler* connection string (put your DB password in it) | PostgreSQL database |
| `SUPABASE_URL` | Project Settings → Data API → *Project URL* | Storage API |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys → *Secret key* (`sb_secret_…`) or legacy *service_role* | Storage API (server only) |
| `SUPABASE_BUCKET` | optional, default `uploads` (created automatically, private) | Storage bucket name |
| `DB_POOL_SIZE` | optional, default `5` | max database connections |

- Tables, indexes and the bucket are created on first start. Every table has row level security enabled with no policies, so Supabase's public REST API (anon key) cannot read them; the server connects as the table owner.
- Each API request runs in one `SERIALIZABLE` transaction (retried automatically on conflicts); files uploaded during a request that fails are deleted again.
- Without `DATABASE_URL` the app uses PGlite (embedded PostgreSQL in `DB_PATH`, default `data/pgdata`); without `SUPABASE_URL` files go to `UPLOAD_DIR` (default `uploads/`).
- `npm start` reads a `.env` file if one exists (`.env` is git-ignored; see `.env.example`).
