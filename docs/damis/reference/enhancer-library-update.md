# اصلاح ساختاری انهنسرهای کتابخانه

یک اصلاح ساختاری برای انهنسر این چت دارم که در کل کتابخانه یکسان اعمال می‌شود. این تغییرات را روی آخرین نسخه‌ی انهنسر اعمال کن، شماره‌ی نسخه را یک واحد بالا ببر، و طبق روال فقط خطوط تغییرکرده را نشانم بده.

**زمینه:** کاراکترها و لوکیشن‌ها در سایت با «کاراکتر شیت» و «لوکیشن شیت» جداگانه تعریف می‌شوند. کاربر فقط اسم یا برچسب می‌دهد (دختر، مرد، ارنواز، مایکل، اتاقش، یک مزرعه). انهنسر نباید هیچ چیزی درباره‌ی چهره، بدن، لباس، مو یا ظاهر لوکیشن بنویسد. فقط عناصر فیلمبرداری را اضافه می‌کند: دوربین، لنز، نور، کادر، گرید و بافت.

---

## ۱. قالب ورودی

این بند را عیناً به انتهای Rule 1 اضافه کن:

```
Input format: characters and locations are defined elsewhere by separate character and location sheets. The user refers to them only by a label or a name ("a girl", "a man", "Arnavaz", "Michael", "Shekar", "her room", "a field"). Copy these labels and names exactly as written; transliterate names written in another script into Latin letters and never translate a name into a description. Never describe any character's appearance, face, body, age, hair, skin, clothing or posture, and never describe what the location looks like: no materials, colors, layout, objects, surfaces or scale of the place. Refer to a named character by name, not by a pronoun that assigns gender. Your words are only about the camera, the lens, the light, the framing, the grade and the texture.
```

---

## ۲. بازبینی کل انهنسر

کل انهنسر را بازبینی کن. هر خطی که انهنسر را به توصیف یا اختراع عناصر صحنه، لباس یا ظاهر وامی‌دارد حذف یا بازنویسی کن. نمونه‌ها:

- «عناصر پیش‌زمینه»
- «قاب در قاب از معماری»
- «فضای زمین و دریا و آسمان»
- «رنگ لباس»
- «رنگ دیوار»

اگر قانون رنگی داری (مثل ۶۰/۳۰/۱۰ یا پالت مشخص)، آن را طوری بنویس که فقط از طریق نور و گرید اجرا شود. این خط را عیناً اضافه کن:

```
Never name the color of a character, clothing, object or part of the location. Color decisions are made only through light and grade; any accent color must come from light itself or from a light source the user named.
```

---

## ۳. چند کاراکتر

این خط را عیناً به **Lens and camera** اضافه کن:

```
- Focus with more than one character: the character who takes the largest part of the frame is sharp, and the others fall softer according to their distance, as in normal cinema. If the user says who should be in focus, follow the user and make that character the sharp one, even if smaller in frame. In wide shots where everyone is small, all characters stay readable.
```

و این خط را عیناً به **Framing and composition** اضافه کن:

```
- Two or more characters: the first character named in the user's text is placed nearer the camera and takes the larger part of the frame; the others sit further back or beside them at a smaller size. Never decide where anyone looks, how they face each other or what they do beyond what the user wrote. All characters share the same light direction; the character in focus sits in slightly better light.
```

بعد از آن، یک خط کوتاه بنویس که بگوید در سبک این فیلمبردار (و در هر مود، اگر مود دارد) دو یا چند نفر معمولاً چطور در کادر قرار می‌گیرند.

---

## ۴. کادر بدون حاشیه

خطی را که در **Lens and camera** درباره‌ی فرمت یا بافت است پیدا کن و این جمله را عیناً به انتهایش اضافه کن:

```
The image is a full-bleed frame: no borders, film edges, sprocket holes, frame lines, letterbox bars or text.
```

و این خط را عیناً به انتهای **Rule 3** اضافه کن:

```
- Always end the prompt with: "full-bleed frame, no borders or film edges."
```

---

## ۵. فضای باز، بسته و نامعلوم

در **Interiors**، منطق تشخیص فضای باز و بسته را عیناً اضافه کن. اگر خطوط فعلی Day interiors و Night interiors با آن تناقض دارند، آن‌ها را بازنویسی کن:

```
- First decide, from the location's words alone, whether outside light can reach it. You cannot see the location sheet, so judge only from the label:
  - Open to outside light: ordinary rooms of homes, kitchens, offices, cafés, shops, classrooms, vehicles above ground. By day, daylight may enter from one side out of frame. No visible light fixtures unless the user named them.
  - Sealed from outside light: basements, cellars, caves, tunnels, mines, bunkers, underground stations and car parks, elevators, cells, vaults, stages, cinemas, server rooms, ship or spacecraft interiors, and any place the user calls windowless, enclosed, sealed or underground (including the word "(enclosed)"). Never use daylight, sunlight, moonlight or sky light here, whatever the time of day the user gave, and do not add a time of day if none was given.
  - Unclear: a generic or invented name ("a room", "the hall", "inside", "Kaveh's workshop"). Describe only the direction and quality of the light ("soft light from one side, out of frame"), never its kind: do not call it daylight, window light, sunlight or lamp light, and do not give it a sky-like tint.
- Light in a sealed space, in this order of preference: 1) a light source the user named (a flashlight, candle, fire, screen), which becomes the key light; 2) the space's own artificial lighting, only if such places normally have it (a station, a car park, an elevator, a stage; not a cave), described only as light falling on the scene, never as a visible fixture; 3) if neither applies, a faint light from off frame.
```

بعد از این بلوک، یک خط کوتاه اضافه کن که بگوید این فیلمبردار نور فضای بسته را چطور می‌سازد: سطح نور، سختی یا نرمی، کنتراست و رنگ. این را از سبک خود فیلمبردار بگیر.

---

## ۶. Rule 3

- طول خروجی را به 50 تا 110 کلمه تغییر بده.
- خط ترتیب را عیناً این‌طور بنویس:

```
- Order: the user's text first, copied as written with names and labels unchanged, then shot size and camera position, lens, light, grade and texture.
```

---

## ۷. مثال‌ها

هر دو مثال انهنسر را با ورودی‌های اسم‌دار بازنویسی کن (یکی روز، یکی شب، حداقل یکی فارسی)، بدون هیچ توصیفی از کاراکتر یا لوکیشن.

---

## تست‌های پایانی

در پایان سه تست نشانم بده:

- یک صحنه‌ی دو نفره،
- یک فضای بسته مثل زیرزمین،
- یک لوکیشن با اسم اختصاصی و نامعلوم، با ورودی فارسی.
