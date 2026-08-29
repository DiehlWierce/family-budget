#!/usr/bin/env python3
"""Разбор Google-таблицы «Траты на 2024» в плоскую модель данных.

Исходник (лист «Годовой бюджет») разложен вбок: 77 блоков-получек по 3-4 колонки.
Скрипт превращает его в data/*.json и печатает отчёт о сверке.
Исходную таблицу не трогает.
"""
import json, re, sys, datetime
from pathlib import Path
from collections import Counter, OrderedDict
from _xlsx import read_sheet, idx_to_col

ROOT = Path(__file__).resolve().parent.parent
SRC = sys.argv[1] if len(sys.argv) > 1 else str(Path.home() / 'Downloads' / 'Траты на 2024.xlsx')
SHEET = 'Годовой бюджет'
EPOCH = datetime.date(1899, 12, 30)
TODAY = datetime.date.today().isoformat()
MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
          'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

# ---------------------------------------------------------------- справочники

# Обязательные траты: 32 сырых названия -> канонические категории.
# Кредиты вынесены в отдельную сущность (debts), но живут как категории тоже.
REQUIRED_MAP = OrderedDict([
    ('Ипотека',                  ('mortgage',        'Ипотека',              'debt')),
    ('Кредит за ремонт',         ('loan-remont-old', 'Кредит за ремонт',     'debt')),
    ('Кредит за ремонт 1.3кк',   ('loan-remont-13',  'Кредит за ремонт 1.3 млн', 'debt')),
    ('Кредит за ремонт 250к',    ('loan-remont-250', 'Кредит за ремонт 250к', 'debt')),
    ('Кредит Даши',              ('loan-dasha',      'Кредит Даши',          'debt')),
    ('Кредит №2 на 650к',        ('loan-650',        'Кредит №2 на 650к',    'debt')),
    ('Кредит №2 на 520к',        ('loan-520',        'Кредит №2 на 520к',    'debt')),
    ('Кредит на 150к',           ('loan-150',        'Кредит на 150к',       'debt')),
    ('Кредит на 250к',           ('loan-250',        'Кредит на 250к',       'debt')),
    ('Кредит на отпуск',         ('loan-otpusk',     'Кредит на отпуск',     'debt')),
    ('Кредит за ноутбук',        ('loan-laptop',     'Кредит за ноутбук',    'debt')),
    ('Рефинансирование',         ('loan-refin',      'Рефинансирование',     'debt')),
    ('Яндекс.Сплит',             ('split-yandex',    'Яндекс.Сплит',         'debt')),
    ('Досрочка №3',              ('loan-early-3',    'Досрочное погашение',  'debt')),
    ('Кредитная карта',          ('credit-card',     'Кредитная карта',      'debt')),
    ('Кредитная карта Тинькофф', ('credit-card',     'Кредитная карта',      'debt')),
    ('Кварплата',                ('utilities',       'Кварплата',            'home')),
    ('Бытовые траты',            ('household',       'Бытовые траты',        'home')),
    ('Спорт',                    ('sport',           'Спорт',                'health')),
    ('Домашний интернет',        ('internet-home',   'Домашний интернет',    'comms')),
    ('Мобильный интернет (Мой)', ('mobile-my',       'Мобильный (мой)',      'comms')),
    ('Мобильный интернет (Даши)',('mobile-dasha',    'Мобильный (Даши)',     'comms')),
    ('Подписка iCloud',          ('sub-icloud',      'iCloud',               'subs')),
    ('Подписка Яндекс.Плюс',     ('sub-yandex',      'Яндекс.Плюс',          'subs')),
    ('Подписка Тинькофф Про',    ('sub-tinkoff',     'Тинькофф Про',         'subs')),
    ('Подписка Snowball',        ('sub-snowball',    'Snowball',             'subs')),
    ('Подписка Ситимобил',       ('sub-citymobil',   'Ситимобил',            'subs')),
    ('Дорога',                   ('transport',       'Дорога',               'transport')),
    ('Еда',                      ('food',            'Еда',                  'food')),
    ('Развлечения',              ('fun',             'Развлечения',          'fun')),
    ('Траты на Дашу',            ('dasha',           'Траты на Дашу',        'dasha')),
    ('Инвестиции',               ('invest',          'Инвестиции',           'savings')),
])

GROUPS = OrderedDict([
    ('debt',      'Долги'),
    ('home',      'Жильё'),
    ('food',      'Еда'),
    ('transport', 'Транспорт'),
    ('health',    'Здоровье и спорт'),
    ('comms',     'Связь'),
    ('subs',      'Подписки'),
    ('fun',       'Развлечения'),
    ('dasha',     'Даша'),
    ('savings',   'Накопления'),
    ('gifts',     'Подарки'),
    ('beauty',    'Внешний вид'),
    ('shopping',  'Покупки'),
    ('vacation',  'Отпуск'),
    ('other',     'Прочее'),
])

# Разовые траты: правила по тексту. Порядок важен — первое совпадение выигрывает.
OPTIONAL_RULES = [
    (r'досроч|кредит|сплит|рассроч|ипотек|рефинанс|комисси за перевод',   'debt-extra',  'Долги (разово)',          'debt'),
    (r'отложить|отложенн|накопл|копил|в долг',                            'savings-move','Отложить / из отложенных','savings'),
    (r'отпуск|море|билеты на самол|отел[ья]|жиль[её] в',                  'vacation-x',  'Отпуск',                  'vacation'),
    (r'даш|для даши|даше|за дашу',                                        'dasha-x',     'Даша (разово)',           'dasha'),
    (r'подар|\bдр\b|день рожд|8 март|23 фев|нг |новый год|санту|санта|цвет|валентин|годовщин|8 марта', 'gifts-x','Подарки и праздники','gifts'),
    (r'психолог|врач|анализ|гинеколог|стоматолог|зуб|клиник|таблет|лекарств|медиц|аптек|очк[иа]|линз', 'health-x','Здоровье','health'),
    (r'\bзал\b|тренер|спорт|\bпт\b|абонемент|пояс для|капу|протеин|турник', 'sport-x','Спорт (разово)',       'health'),
    (r'барбер|челк|маникюр|космет|стрижк|бров|ногт|педикюр',              'beauty-x',    'Внешний вид',             'beauty'),
    (r'такси|бензин|авто|страховк|шиномонт|осаго|каско|права|автошкол|на дорогу|проездн', 'transport-x','Транспорт (разово)','transport'),
    (r'концерт|билет|кино|ресторан|\bбар\b|вечеринк|корпоратив|настолк|игр|стим|steam|развлеч|клуб|тус[уа]|гулянк|спектакл|алко|вино|кальян|читмил|дискотек|квест|поход', 'fun-x','Развлечения (разово)','fun'),
    (r'\bвб\b|wildberries|озон|ozon|купить|покупк|заказ|техник|ноутбук|телефон|пылесос|планшет|ботинк|кроссов|джерси|одежд|куртк|футболк|штан|обув|рюкзак|наушник|часы', 'shopping-x','Покупки','shopping'),
    (r'кварплат|квартир|коммунал|ремонт|мебел|быто',                      'home-x',      'Жильё (разово)',          'home'),
    (r'\bеда\b|продукт|достав[кч]|кафе|обед|завтрак|ужин',              'food-x',      'Еда (разово)',            'food'),
    (r'подписк|icloud|яндекс.плюс|тинькофф про',                          'subs-x',      'Подписки (разово)',       'subs'),
]

INCOME_RULES = [
    (r'отпускн',                       'inc-vacation',  'Отпускные'),
    (r'от даши|даша верн|от даш',      'inc-dasha',     'От Даши'),
    (r'из отложенн|из накопл|из копил','inc-savings',   'Из отложенных'),
    (r'остат|с прошлой',               'inc-carryover', 'Остаток с прошлой получки'),
    (r'преми|бонус|13[-\s]?я',         'inc-bonus',     'Премия'),
    (r'кэшб|кешб|cashback|возврат|вернул','inc-refund', 'Возврат / кэшбэк'),
    (r'^от |подарил|скинул',           'inc-person',    'От людей'),
]


def classify(title, rules, default):
    low = title.lower()
    for pattern, cid, name, *rest in rules:
        if re.search(pattern, low):
            return (cid, name, rest[0] if rest else None)
    return default


def build_templates(paychecks, entries, cats):
    """Шаблон будущих получек: регулярная база плюс ежегодные события из истории."""
    past = [p for p in paychecks if p['date'] <= TODAY]
    last_id = paychecks[-1]['id']
    y, m, _ = last_id.split('-')
    y, m = int(y), int(m)
    m += 1
    if m > 12:
        m, y = 1, y + 1
    start = '%04d-%02d-1' % (y, m)

    out, order = [], 0

    # Регулярные обязательные. Одну и ту же трату он двигает между получками месяца,
    # поэтому берём типичную сумму за МЕСЯЦ и делим по получкам в той же пропорции.
    months = sorted({(p['periodYear'], p['periodMonth']) for p in past})[-4:]
    month_ids = {}
    for y, m in months:
        month_ids[(y, m)] = {p['slot']: p['id'] for p in paychecks if (p['periodYear'], p['periodMonth']) == (y, m)}

    titles = []
    for slot in (1, 2):
        source = [p for p in past if p['slot'] == slot]
        if source:
            for e in sorted([x for x in entries if x['paycheckId'] == source[-1]['id']
                             and x['kind'] == 'required'], key=lambda x: x['order']):
                if e['title'] not in [t['title'] for t in titles]:
                    titles.append({'title': e['title'], 'categoryId': e['categoryId'], 'order': e['order']})

    def median(xs):
        xs = sorted(xs)
        return xs[len(xs) // 2] if xs else 0

    for info in titles:
        totals_by_month, shares = [], []
        for key, ids in month_ids.items():
            per_slot = {}
            for slot, pid in ids.items():
                per_slot[slot] = sum(e['plan'] or 0 for e in entries
                                     if e['paycheckId'] == pid and e['kind'] == 'required'
                                     and e['title'] == info['title'])
            total = sum(per_slot.values())
            totals_by_month.append(total)
            if total > 0:
                shares.append(per_slot.get(1, 0) / total)
        amount_month = median(totals_by_month)
        share1 = median(shares) if shares else 0.0
        first = round(amount_month * share1)
        parts = {1: first, 2: round(amount_month) - first}
        for slot in (1, 2):
            order += 1
            out.append({
                'id': 'tpl-req-%d-%d' % (slot, order),
                'title': info['title'], 'categoryId': info['categoryId'], 'kind': 'required',
                'amount': parts[slot], 'slot': slot, 'freq': 'each',
                'from': start, 'to': None, 'order': info['order'],
            })

    # Ежегодные события: то, что повторялось в одном и том же месяце минимум в двух годах.
    by_pid = {p['id']: p for p in paychecks}
    buckets = {}
    for e in entries:
        if e['kind'] != 'optional' or not e['plan'] or e['plan'] <= 0:
            continue
        p = by_pid.get(e['paycheckId'])
        if not p:
            continue
        key = (norm_title(e['title']), p['periodMonth'], p['slot'])
        buckets.setdefault(key, []).append((p['periodYear'], e))
    for (title, month, slot), hits in sorted(buckets.items()):
        years = {y for y, _ in hits}
        if len(years) < 2:
            continue
        amounts = sorted(e['plan'] for _, e in hits)
        order += 1
        sample = hits[-1][1]
        out.append({
            'id': 'tpl-year-%d' % order,
            'title': sample['title'], 'categoryId': sample['categoryId'], 'kind': 'optional',
            'amount': amounts[len(amounts) // 2], 'slot': slot, 'freq': 'yearly', 'month': month,
            'from': start, 'to': None, 'order': 100 + order,
            'note': 'повторялось в %s' % ', '.join(str(y) for y in sorted(years)),
        })
    return out


def norm_title(t):
    t = t.lower().replace('ё', 'е')
    t = re.sub(r'\([^)]*\)', '', t)
    t = re.sub(r'\d+\s*ч\.?', '', t)
    t = re.sub(r'[^а-яa-z ]', ' ', t)
    t = re.sub(r'\s+', ' ', t).strip()
    for prefix in ('на ', 'для ', 'от ', 'из '):
        if t.startswith(prefix):
            t = t[len(prefix):]
    return t


# ---------------------------------------------------------------- разбор листа

def main():
    cells, _ = read_sheet(SRC, SHEET)
    def g(c, r):                      # r — номер строки как в таблице, с 1
        return cells.get((c, r - 1))

    max_col = max(c for c, _ in cells)
    block_cols = [c for c in range(max_col + 1) if g(c, 3) == 'Дата:']

    paychecks, entries, anomalies = [], [], []
    cat_seen = OrderedDict()

    def remember(cid, name, group):
        if cid not in cat_seen:
            cat_seen[cid] = {'id': cid, 'name': name, 'group': group,
                             'groupName': GROUPS.get(group, 'Прочее')}
        return cid

    for n, c in enumerate(block_cols):
        serial = g(c + 1, 3)
        if not isinstance(serial, (int, float)):
            anomalies.append({'block': idx_to_col(c), 'issue': 'дата не распознана', 'value': serial})
            continue
        date = EPOCH + datetime.timedelta(days=int(serial))

        # получка «6 числа» может уехать на конец предыдущего месяца
        if date.day >= 26:
            period_y, period_m = (date.year + 1, 1) if date.month == 12 else (date.year, date.month + 1)
            slot = 1
        else:
            period_y, period_m = date.year, date.month
            slot = 1 if date.day <= 15 else 2

        pid = '%04d-%02d-%d' % (period_y, period_m, slot)

        split = None
        for r in range(10, 53):
            if g(c, r) == 'Необязательные траты':
                split = r
                break
        split = split or 29

        plan_sum = 0.0
        for r in range(10, 53):
            label, plan, fact = g(c, r), g(c + 1, r), g(c + 2, r)
            if isinstance(label, (int, float)):
                anomalies.append({'block': idx_to_col(c), 'paycheck': pid, 'row': r,
                                  'issue': 'число вместо названия — ручная поправка',
                                  'value': label})
                continue
            if isinstance(label, str):
                label = label.strip()
            if label in ('Траты', 'Размер траты', 'Обязательные траты', 'Необязательные траты'):
                continue
            has_plan = isinstance(plan, (int, float))
            has_fact = isinstance(fact, (int, float))
            if not label and not has_plan and not has_fact:
                continue
            if not label:
                anomalies.append({'block': idx_to_col(c), 'paycheck': pid, 'row': r,
                                  'issue': 'сумма без названия', 'value': plan})
                continue
            if has_plan:
                plan_sum += plan

            required = r < split
            amount = plan if has_plan else None
            income = (has_plan and plan < 0) or (not has_plan and has_fact and fact < 0)

            if income:
                cid, name, _ = classify(label, [(p, i, nm, None) for p, i, nm in INCOME_RULES],
                                        ('inc-other', 'Прочий приход', None))
                remember(cid, name, 'income')
                kind = 'income'
                plan_v = -plan if has_plan else None
                fact_v = -fact if has_fact else None
            elif required:
                cid, name, group = REQUIRED_MAP.get(label, ('other', 'Прочее', 'other'))
                remember(cid, name, group)
                kind = 'required'
                plan_v, fact_v = (plan if has_plan else None), (fact if has_fact else None)
            else:
                cid, name, group = classify(label, OPTIONAL_RULES, ('other-x', 'Прочее', 'other'))
                remember(cid, name, group)
                kind = 'optional'
                plan_v, fact_v = (plan if has_plan else None), (fact if has_fact else None)

            entries.append({
                'id': '%s-%02d' % (pid, r),
                'paycheckId': pid, 'kind': kind, 'categoryId': cid,
                'title': label, 'plan': plan_v, 'fact': fact_v,
                'order': r,
            })

        salary = g(c + 1, 4) or 0
        declared_spend = g(c + 1, 5)
        declared_rest = g(c + 1, 6)
        paychecks.append({
            'id': pid, 'date': date.isoformat(),
            'periodYear': period_y, 'periodMonth': period_m, 'slot': slot,
            'salaryOverride': salary if date.isoformat() <= TODAY else None,
            'salaryFact': None,
            'legacy': {'column': idx_to_col(c),
                       'declaredSpend': declared_spend,
                       'declaredRest': declared_rest,
                       'entriesSum': round(plan_sum, 2)},
        })

    # ------------------------------------------------------------ сверка
    mismatch = []
    for p in paychecks:
        d = p['legacy']['declaredSpend']
        if not isinstance(d, (int, float)):
            continue
        diff = round(p['legacy']['entriesSum'] - d, 2)
        if abs(diff) > 0.5:
            mismatch.append({'paycheck': p['id'], 'column': p['legacy']['column'],
                             'declared': d, 'parsed': p['legacy']['entriesSum'], 'diff': diff})

    dup = [k for k, v in Counter(p['id'] for p in paychecks).items() if v > 1]

    categories = list(cat_seen.values())
    debts = [c for c in categories if c['group'] == 'debt']

    out = ROOT / 'public' / 'data'
    out.mkdir(exist_ok=True)
    def dump(name, obj):
        (out / name).write_text(json.dumps(obj, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

    dump('meta.json', {'updatedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
                       'source': 'migration'})
    dump('paychecks.json', paychecks)
    dump('entries.json', entries)
    dump('categories.json', categories)
    dump('groups.json', [{'id': k, 'name': v} for k, v in GROUPS.items()])
    dump('templates.json', build_templates(paychecks, entries, cat_seen))
    dump('salary.json', {
        'history': [{'from': TODAY[:8] + '01', 'monthly': 215000,
                     'note': 'актуальный оклад — поправь, если не так'}],
        'indexation': {'enabled': True, 'month': 9, 'percent': 5},
    })
    dump('calendar.json', {
        # Переносы конца года утверждает постановление, правило их не знает.
        'extraHolidays': ['2024-12-30', '2024-12-31', '2026-12-31'],
        'extraWorkdays': ['2024-12-28'],
    })
    dump('migration-report.json', {
        'source': SRC, 'sheet': SHEET,
        'paychecks': len(paychecks), 'entries': len(entries),
        'categories': len(categories), 'debts': len(debts),
        'duplicatePaycheckIds': dup,
        'reconciliationMismatches': mismatch,
        'anomalies': anomalies,
        'templates': len(build_templates(paychecks, entries, cat_seen)),
    })

    kinds = Counter(e['kind'] for e in entries)
    print('получек:      %d  (%s → %s)' % (len(paychecks), paychecks[0]['date'], paychecks[-1]['date']))
    print('строк трат:   %d  (обязательных %d, разовых %d, приходов %d)'
          % (len(entries), kinds['required'], kinds['optional'], kinds['income']))
    print('с фактом:     %d' % sum(1 for e in entries if e['fact'] is not None))
    print('категорий:    %d  (из них кредитов %d)' % (len(categories), len(debts)))
    print('дубли id:     %s' % (dup or 'нет'))
    print('расхождения:  %d из %d' % (len(mismatch), len(paychecks)))
    for m in mismatch[:12]:
        print('   %s  колонка %-4s  в таблице %12.2f  собрано %12.2f  разница %10.2f'
              % (m['paycheck'], m['column'], m['declared'], m['parsed'], m['diff']))
    print('аномалии:     %d' % len(anomalies))
    for a in anomalies[:8]:
        print('   %s' % a)


if __name__ == '__main__':
    main()
