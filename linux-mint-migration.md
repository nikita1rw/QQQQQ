# Переход с Windows 11 на Linux Mint

## Какой дистрибутив выбрать
**Для большинства — Linux Mint (Cinnamon):** похож на Windows, основан на Ubuntu LTS, кодеки и драйверы из коробки, Flatpak, нетребователен к железу.

Другие варианты:
- Ubuntu / Kubuntu — максимум поддержки и документации
- Fedora Workstation — свежее ПО, хороша для разработки
- Pop!_OS — ноутбуки с NVIDIA, игры, тайлинг
- Manjaro / EndeavourOS — свежие версии, требуют внимания
- Debian — максимум стабильности
- Zorin OS — максимально «под Windows»

Новичок → Mint. Игры → Pop!_OS или Nobara/Bazzite. Разработка → Fedora или Ubuntu.

## Важно
Приложения Windows не переносятся — их заменяют аналогами или запускают через Wine/виртуалку. Переносятся только данные.

## 1. Подготовка (до установки)
**Инвентаризация программ:** выпишите всё из «Параметры → Приложения», найдите аналоги, проверьте на appdb.winehq.org и protondb.com (игры).

**Данные для копирования:**
- Документы, Изображения, Видео, Музыка, Рабочий стол, Загрузки
- Браузеры: включить синхронизацию аккаунта
- Пароли: экспорт или Bitwarden/KeePass
- Почта: Outlook → экспорт PST или Thunderbird
- Сохранения игр, ключи лицензий, SSH-ключи, конфиги
- Нужные папки из `C:\Users\<имя>\AppData`

**Дополнительно:**
- Полный образ диска (Macrium Reflect, Clonezilla)
- Запишите лицензионные ключи
- Отключите BitLocker и Быстрый запуск (`powercfg /h off`)
- Secure Boot Mint обычно поддерживает — не трогать

## 2. Установка Mint
1. ISO с linuxmint.com → флешка (Rufus / Balena Etcher)
2. Загрузка с флешки (F12/Esc/Del)
3. Сначала Live-режим: проверить Wi-Fi, звук, видео
4. Установка рядом с Windows (dual boot, безопаснее) или со стиранием диска (после проверки бэкапа)

## 3. После установки
```bash
sudo apt update && sudo apt upgrade
```
- «Менеджер драйверов» → драйвер NVIDIA
- Снимок системы в Timeshift
- Вернуть данные в домашнюю папку

## 4. Замена приложений
| Windows | Linux |
|---|---|
| MS Office | LibreOffice, OnlyOffice, Office 365 в браузере |
| Photoshop | GIMP, Krita |
| Premiere / Vegas | Kdenlive, DaVinci Resolve |
| Illustrator | Inkscape |
| Outlook | Thunderbird |
| Notepad++ | Kate, VS Code |
| 7-Zip | Встроенный архиватор / p7zip |
| uTorrent | qBittorrent |
| VLC, OBS | Есть нативно |
| Telegram, Discord, Spotify, Steam, VS Code | Нативно или Flatpak |
| AutoCAD, Adobe CC | Нет замены → виртуалка / dual boot |

## 5. Если без Windows-программы никак
- Wine / Bottles / Lutris
- Steam + Proton
- Виртуальная машина (VirtualBox, virt-manager)
- Dual boot

## Подводные камни
- Игры с античитом (Valorant, Fortnite, часть Call of Duty) не запустятся
- Принтеры/сканеры — проверить поддержку производителя
- NTFS читается, но рабочие файлы Linux на ней не хранить
- Wi-Fi Realtek/Broadcom может потребовать драйвер (нужен проводной интернет)

## Дальше
Дома пришлите: список программ (особенно Adobe, Office, САПР, игры), модель ПК/ноутбука, видеокарту, объём диска, и как будете ставить (рядом с Windows или вместо).
