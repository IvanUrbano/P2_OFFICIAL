import json, numpy as np
from collections import Counter, defaultdict
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score

D = json.load(open('_tmp_rows.json'))
rows = D['rows']
BASE = ["rolling_12m_incidence","recent_trend","seasonality_flag",
        "lag_1m","lag_2m","lag_3m","neighbor_risk","historical_bias"]

months_all = sorted({r['month'] for r in rows})
by_month = {m: sorted([r for r in rows if r['month']==m], key=lambda x: x['barangay_name']) for m in months_all}

def pct_rank(vals):
    order = np.argsort(np.argsort(np.asarray(vals, float)))
    return order / max(len(vals)-1, 1)

# Relative features, all from data strictly BEFORE the target month.
for mi, m in enumerate(months_all):
    grp = by_month[m]
    r12 = pct_rank([r['features']['rolling_12m_incidence'] or 0 for r in grp])
    l1  = pct_rank([r['features']['lag_1m'] or 0 for r in grp])
    tr  = pct_rank([r['features']['recent_trend'] or 0 for r in grp])
    for r, a, b, c in zip(grp, r12, l1, tr):
        r['rel'] = {'rank_roll12': float(a), 'rank_lag1': float(b), 'rank_trend': float(c)}

# Prior-month tertile band of the barangay, from its own rank history.
prev_band = {}
for mi, m in enumerate(months_all):
    for r in by_month[m]:
        r['rel']['prev_band_num'] = prev_band.get(r['barangay_name'], 1.0)
    for r in by_month[m]:
        q = r['rel']['rank_roll12']
        prev_band[r['barangay_name']] = 0.0 if q < 1/3 else (2.0 if q >= 2/3 else 1.0)

REL = ["rank_roll12","rank_lag1","rank_trend","prev_band_num"]

def vec(r, feats):
    out = []
    for k in feats:
        out.append(float((r['features'].get(k) if k in BASE else r['rel'].get(k)) or 0))
    return out

def label_relative(grp, key):
    """Tertile RANK within the month's cross-section -> exactly 1/3 each."""
    vals = [g[key] for g in grp]
    q = pct_rank(vals)
    return np.array(['Low' if x < 1/3 else ('High' if x >= 2/3 else 'Medium') for x in q])

def run(label_key, feats, tag):
    valid = [m for m in months_all if all(r[label_key] is not None for r in by_month[m])]
    if len(valid) < 14: return None
    ys, ps, bs = [], [], []
    for i in range(12, len(valid)):
        tr_ms, te_m = valid[:i], valid[i]
        Xtr, ytr = [], []
        for m in tr_ms:
            g = by_month[m]
            Xtr += [vec(r, feats) for r in g]; ytr += list(label_relative(g, label_key))
        g = by_month[te_m]
        Xte = [vec(r, feats) for r in g]; yte = list(label_relative(g, label_key))
        if len(set(ytr)) < 2: continue
        clf = RandomForestClassifier(n_estimators=300 if len(Xtr)>=400 else 200,
                                     max_depth=8 if len(Xtr)>=400 else 4,
                                     min_samples_split=10, min_samples_leaf=5,
                                     random_state=42, class_weight='balanced')
        clf.fit(Xtr, ytr)
        ys += yte; ps += list(clf.predict(Xte))
        bs += [Counter(ytr).most_common(1)[0][0]]*len(yte)
    if not ys: return None
    return dict(tag=tag, n=len(ys), acc=accuracy_score(ys,ps),
                f1=f1_score(ys,ps,average='macro',zero_division=0),
                base=accuracy_score(ys,bs), clf=clf, feats=feats)

print(f"{'variant':<56}{'n':>5}{'acc':>8}{'f1':>8}{'base':>8}{'lift':>8}")
print('-'*95)
best = None
for lk, ln in [('inc_1m','1-month'),('inc_fwd3','fwd 3-month'),('inc_fwd6','fwd 6-month')]:
    for feats, fn in [(BASE,'8 base features'), (BASE+REL,'base + relative-rank features')]:
        r = run(lk, feats, f"{ln} relative-tertile | {fn}")
        if not r: continue
        print(f"{r['tag']:<56}{r['n']:>5}{r['acc']*100:>7.1f}%{r['f1']:>8.3f}{r['base']*100:>7.1f}%{(r['acc']-r['base'])*100:>+7.1f}")
        if best is None or r['acc'] > best['acc']: best = r

print(f"\nBEST: {best['tag']}  ->  {best['acc']*100:.1f}% (baseline {best['base']*100:.1f}%)")
imp = sorted(zip(best['feats'], best['clf'].feature_importances_), key=lambda x:-x[1])
print("\nFeature importance (best model):")
for k,v in imp: print(f"  {k:<26}{v*100:5.1f}%")
