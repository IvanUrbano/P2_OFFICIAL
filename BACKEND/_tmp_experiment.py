import json, numpy as np
from collections import Counter
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score

D = json.load(open('_tmp_rows.json'))
rows = D['rows']
FEATURES = ["rolling_12m_incidence","recent_trend","seasonality_flag",
            "lag_1m","lag_2m","lag_3m","neighbor_risk","historical_bias"]

def vec(f): return [float(f.get(k) or 0) for k in FEATURES]

def bands(values, lo, hi):
    return np.array(['Low' if v <= lo else ('High' if v > hi else 'Medium') for v in values])

def tertiles(values):
    v = np.sort(np.asarray(values, float))
    p = lambda q: float(np.interp(q*(len(v)-1), np.arange(len(v)), v))
    return p(1/3), p(2/3)

def walk_forward(label_key, calib):
    """calib: 'cross_section' (current) or 'pooled' (Fix 1)."""
    rs = [r for r in rows if r[label_key] is not None]
    months = sorted({r['month'] for r in rs})
    if len(months) < 14: return None
    by_month = {m: [r for r in rs if r['month'] == m] for m in months}

    acc_y, acc_p, base_y = [], [], []
    for i in range(12, len(months)):
        tr = [r for m in months[:i] for r in by_month[m]]
        te = by_month[months[i]]
        if not tr or not te: continue

        if calib == 'cross_section':
            # Current behaviour: cut points from ONE month's cross-section.
            lo, hi = tertiles([r[label_key] for r in by_month[months[i-1]]])
        else:
            # Fix 1: cut points from the pooled data actually being labelled.
            lo, hi = tertiles([r[label_key] for r in tr])

        ytr = bands([r[label_key] for r in tr], lo, hi)
        yte = bands([r[label_key] for r in te], lo, hi)
        if len(set(ytr)) < 2: continue

        clf = RandomForestClassifier(
            n_estimators=300 if len(tr) >= 400 else 200,
            max_depth=8 if len(tr) >= 400 else 4,
            min_samples_split=10, min_samples_leaf=5,
            random_state=42, class_weight='balanced')
        clf.fit([vec(r['features']) for r in tr], ytr)
        pred = clf.predict([vec(r['features']) for r in te])

        acc_y.extend(yte); acc_p.extend(pred)
        maj = Counter(ytr).most_common(1)[0][0]
        base_y.extend([maj]*len(yte))

    if not acc_y: return None
    acc = accuracy_score(acc_y, acc_p)
    base = accuracy_score(acc_y, base_y)
    dist = Counter(acc_y)
    tot = sum(dist.values())
    return dict(n=len(acc_y), acc=acc, f1=f1_score(acc_y, acc_p, average='macro', zero_division=0),
                base=base, lift=acc-base,
                dist={k: round(100*v/tot,1) for k,v in sorted(dist.items())})

print(f"{'variant':<42}{'n':>5}{'acc':>8}{'f1':>8}{'baseline':>10}{'lift':>8}   label balance")
print('-'*110)
for label, lname in [('inc_1m','single month'),('inc_fwd3','next 3 months'),
                     ('inc_fwd6','next 6 months'),('inc_fwd12','next 12 months')]:
    for calib, cname in [('cross_section','1-month cut-offs'),('pooled','pooled cut-offs')]:
        r = walk_forward(label, calib)
        if not r: continue
        tag = f"{lname} + {cname}"
        star = '  <<<' if calib=='pooled' and label=='inc_fwd12' else ''
        print(f"{tag:<42}{r['n']:>5}{r['acc']*100:>7.1f}%{r['f1']:>8.3f}{r['base']*100:>9.1f}%{r['lift']*100:>+7.1f}   {r['dist']}{star}")
