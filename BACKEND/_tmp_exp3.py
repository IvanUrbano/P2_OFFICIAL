import json, numpy as np, warnings
warnings.filterwarnings('ignore')
from collections import Counter
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score

D = json.load(open('_tmp_rows.json')); rows = D['rows']
BASE = ["rolling_12m_incidence","recent_trend","seasonality_flag","lag_1m","lag_2m","lag_3m","neighbor_risk","historical_bias"]
LEAN = ["rolling_12m_incidence","recent_trend","lag_1m","lag_2m","lag_3m","neighbor_risk"]
months_all = sorted({r['month'] for r in rows})
by_month = {m: sorted([r for r in rows if r['month']==m], key=lambda x:x['barangay_name']) for m in months_all}

def pct_rank(v):
    return np.argsort(np.argsort(np.asarray(v,float)))/max(len(v)-1,1)

for m in months_all:
    g = by_month[m]
    for r,a,b,c in zip(g, pct_rank([r['features']['rolling_12m_incidence'] or 0 for r in g]),
                          pct_rank([r['features']['lag_1m'] or 0 for r in g]),
                          pct_rank([r['features']['recent_trend'] or 0 for r in g])):
        r['rel'] = {'rank_roll12':float(a),'rank_lag1':float(b),'rank_trend':float(c)}
prev = {}
for m in months_all:
    for r in by_month[m]: r['rel']['prev_band_num'] = prev.get(r['barangay_name'],1.0)
    for r in by_month[m]:
        q=r['rel']['rank_roll12']; prev[r['barangay_name']] = 0.0 if q<1/3 else (2.0 if q>=2/3 else 1.0)
REL = ["rank_roll12","rank_lag1","rank_trend","prev_band_num"]

def vec(r,f): return [float((r['features'].get(k) if k in BASE else r['rel'].get(k)) or 0) for k in f]
def lab3(g,k):
    q=pct_rank([x[k] for x in g]); return ['Low' if x<1/3 else ('High' if x>=2/3 else 'Medium') for x in q]
def lab2(g,k):
    q=pct_rank([x[k] for x in g]); return ['High' if x>=2/3 else 'Not High' for x in q]

def run(lk, feats, labfn, params):
    valid=[m for m in months_all if all(r[lk] is not None for r in by_month[m])]
    ys,ps,bs=[],[],[]
    for i in range(12,len(valid)):
        Xtr,ytr=[],[]
        for m in valid[:i]:
            g=by_month[m]; Xtr+=[vec(r,feats) for r in g]; ytr+=labfn(g,lk)
        g=by_month[valid[i]]; Xte=[vec(r,feats) for r in g]; yte=labfn(g,lk)
        if len(set(ytr))<2: continue
        clf=RandomForestClassifier(random_state=42,class_weight='balanced',**params)
        clf.fit(Xtr,ytr); ys+=yte; ps+=list(clf.predict(Xte))
        bs+=[Counter(ytr).most_common(1)[0][0]]*len(yte)
    if not ys: return None
    return accuracy_score(ys,ps), f1_score(ys,ps,average='macro',zero_division=0), accuracy_score(ys,bs), len(ys)

GRID=[dict(n_estimators=300,max_depth=8,min_samples_split=10,min_samples_leaf=5),
      dict(n_estimators=500,max_depth=6,min_samples_split=8,min_samples_leaf=4),
      dict(n_estimators=500,max_depth=None,min_samples_split=4,min_samples_leaf=2),
      dict(n_estimators=800,max_depth=10,min_samples_split=6,min_samples_leaf=3)]

print("=== 3-CLASS (Low / Medium / High) ===")
print(f"{'label':<14}{'features':<10}{'params':<34}{'acc':>8}{'f1':>8}{'base':>8}{'lift':>8}")
best3=None
for lk,ln in [('inc_fwd3','fwd3'),('inc_fwd6','fwd6')]:
    for feats,fn in [(BASE,'base8'),(BASE+REL,'base+rel'),(LEAN+REL,'lean+rel')]:
        for p in GRID:
            r=run(lk,feats,lab3,p)
            if not r: continue
            acc,f1,base,n=r; ptag=f"t{p['n_estimators']} d{p['max_depth']} s{p['min_samples_split']} l{p['min_samples_leaf']}"
            print(f"{ln:<14}{fn:<10}{ptag:<34}{acc*100:>7.1f}%{f1:>8.3f}{base*100:>7.1f}%{(acc-base)*100:>+7.1f}")
            if best3 is None or acc>best3[0]: best3=(acc,f1,base,ln,fn,ptag)

print("\n=== 2-CLASS (High / Not High) ===")
best2=None
for lk,ln in [('inc_fwd3','fwd3'),('inc_fwd6','fwd6')]:
    for feats,fn in [(BASE,'base8'),(BASE+REL,'base+rel')]:
        for p in GRID[:2]:
            r=run(lk,feats,lab2,p)
            if not r: continue
            acc,f1,base,n=r; ptag=f"t{p['n_estimators']} d{p['max_depth']}"
            print(f"{ln:<14}{fn:<10}{ptag:<34}{acc*100:>7.1f}%{f1:>8.3f}{base*100:>7.1f}%{(acc-base)*100:>+7.1f}")
            if best2 is None or acc>best2[0]: best2=(acc,f1,base,ln,fn,ptag)

print(f"\nBEST 3-class: {best3[0]*100:.1f}% (base {best3[2]*100:.1f}%, lift +{(best3[0]-best3[2])*100:.1f}) -> {best3[3]} {best3[4]} {best3[5]}")
print(f"BEST 2-class: {best2[0]*100:.1f}% (base {best2[2]*100:.1f}%, lift +{(best2[0]-best2[2])*100:.1f}) -> {best2[3]} {best2[4]} {best2[5]}")
