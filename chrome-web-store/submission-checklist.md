# Чек-лист публикации

## Блокеры, требующие владельца

- [ ] Зарегистрировать Chrome Web Store developer account и оплатить разовый регистрационный сбор.
- [ ] Включить двухэтапную аутентификацию Google-аккаунта.
- [ ] Указать publisher name и подтвердить контактный email.
- [x] Указать публичный контакт для вопросов о конфиденциальности.
- [ ] После push проверить privacy policy по публичному HTTPS URL без авторизации.
- [ ] Подготовить тестовый Redmine и отдельные credentials для модератора.
- [ ] Сделать обезличенные реальные скриншоты по инструкции `assets/README.md`.

## Перед загрузкой

- [ ] Запустить `generate-assets.ps1` и `build.ps1`.
- [ ] Распаковать созданный ZIP во временную папку и загрузить именно её как unpacked extension.
- [ ] Проверить popup, список задач, страницу задачи, превью, события, избранное, историю и группы наблюдателей.
- [ ] Убедиться, что `manifest.json` лежит в корне ZIP.
- [ ] Убедиться, что в ZIP нет `.git`, документации store, логов, тестовых credentials и приватных данных.

## Developer Dashboard

- [ ] Add new item → загрузить ZIP из `package/`.
- [ ] Store listing → вставить тексты из `listing-ru.md`.
- [ ] Загрузить store icon, small promo tile и минимум один screenshot.
- [ ] Privacy practices → вставить ответы из `privacy-practices.md`.
- [ ] Указать публичный Privacy policy URL.
- [ ] Test instructions → вставить `review-notes.md` и безопасные тестовые credentials.
- [ ] Distribution → выбрать `Unlisted` для раздачи по ссылке либо `Private` для trusted testers/Google Group.
- [ ] Выбрать deferred publishing, если хотите сначала проверить результат модерации и опубликовать вручную.
- [ ] Submit for Review.

## После публикации

- [ ] Открыть карточку в чистом профиле Chrome и проверить установку по ссылке.
- [ ] Для `Private` проверить установку из Google-аккаунта, добавленного в trusted testers или разрешённую Google Group.
- [ ] Сохранить ID расширения и URL карточки.
- [ ] Для каждого обновления повышать `version`, собирать новый ZIP и актуализировать listing/privacy при изменении функций или данных.
