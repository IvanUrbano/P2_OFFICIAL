-- Migration 013: Replace all 30 Pasig City barangay boundary polygons with official
-- NAMRIA/PSA-sourced geometry (PSGC 2023 boundaries, NAMRIA survey v2023-11-06),
-- via the enriched barangay-boundaries-repository dataset (MIT-licensed redistribution,
-- data (c) PSA/NAMRIA): https://github.com/bendlikeabamboo/barangay-boundaries-repository
--
-- Reason: the previous "Bagong Katipunan" polygon (added in migration 012) was a
-- hand-estimated hexagon that overlapped San Jose and Sumilang and left gaps against
-- its other neighbors. Rather than hand-fix one polygon against neighbors that may
-- themselves be imprecise, this migration replaces ALL 30 Pasig barangay polygons with
-- geometry pulled from one single official, internally-consistent source, so shared
-- borders line up (verified: Bagong Katipunan now shares an exact vertex with Malinao
-- and is within ~8-14m of Bambang/Sumilang/San Jose -- the same 4 neighbors PhilAtlas
-- lists for it -- and is 400m+ away from every barangay that should NOT be adjacent).
--
-- Centroids are also refreshed to match (simple vertex-average of each polygon, used
-- only for map label placement, not for any geometric calculation).

UPDATE barangays SET centroid_lon = 121.06895482280004, centroid_lat = 14.567597712000055 WHERE name = 'Bagong Ilog';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.06825722600001, 14.574393316000055], [121.07438880400002, 14.570194898000068], [121.06913359600003, 14.558092158000022], [121.06473726200011, 14.560914872000069], [121.06825722600001, 14.574393316000055]]]]}'), 4326) WHERE name = 'Bagong Ilog';

UPDATE barangays SET centroid_lon = 121.07452536375007, centroid_lat = 14.558713550250047 WHERE name = 'Bagong Katipunan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07354253000005, 14.55914791300006], [121.0757558030001, 14.55921371200003], [121.07526059200006, 14.557344663000038], [121.07354253000005, 14.55914791300006]]]]}'), 4326) WHERE name = 'Bagong Katipunan';

UPDATE barangays SET centroid_lon = 121.07805102300006, centroid_lat = 14.555636452500053 WHERE name = 'Bambang';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07519298500006, 14.557364556000039], [121.08814211800006, 14.55284664800007], [121.07367600400005, 14.554970050000065], [121.07519298500006, 14.557364556000039]]]]}'), 4326) WHERE name = 'Bambang';

UPDATE barangays SET centroid_lon = 121.06847185600003, centroid_lat = 14.55327759775004 WHERE name = 'Buting';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.06431954100003, 14.551917179000043], [121.07230926700004, 14.55547430300004], [121.07293907500002, 14.553801730000032], [121.06431954100003, 14.551917179000043]]]]}'), 4326) WHERE name = 'Buting';

UPDATE barangays SET centroid_lon = 121.07801739575007, centroid_lat = 14.570828493250048 WHERE name = 'Caniogan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.0752475700001, 14.572922414000061], [121.08822441500001, 14.572623326000041], [121.07335002800005, 14.564845819000027], [121.0752475700001, 14.572922414000061]]]]}'), 4326) WHERE name = 'Caniogan';

UPDATE barangays SET centroid_lon = 121.09689891200006, centroid_lat = 14.616174510600057 WHERE name = 'Dela Paz';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.09323587300003, 14.621323511000071], [121.10187866500007, 14.620657343000062], [121.10415858800002, 14.608365045000028], [121.09198556100012, 14.609203143000059], [121.09323587300003, 14.621323511000071]]]]}'), 4326) WHERE name = 'Dela Paz';

UPDATE barangays SET centroid_lon = 121.08590024480006, centroid_lat = 14.550907579400041 WHERE name = 'Kalawaan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.08088592700005, 14.553772451000043], [121.09226892700008, 14.552824451000049], [121.09436799700006, 14.546736230000022], [121.08109244600007, 14.547432314000048], [121.08088592700005, 14.553772451000043]]]]}'), 4326) WHERE name = 'Kalawaan';

UPDATE barangays SET centroid_lon = 121.07424583900007, centroid_lat = 14.563203103000049 WHERE name = 'Kapasigan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07335002800005, 14.564845819000027], [121.07731302400009, 14.561341474000074], [121.07297027600009, 14.561779300000069], [121.07335002800005, 14.564845819000027]]]]}'), 4326) WHERE name = 'Kapasigan';

UPDATE barangays SET centroid_lon = 121.06082118400005, centroid_lat = 14.571848334200046 WHERE name = 'Kapitolyo';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.05816440000001, 14.577301557000055], [121.0664963260001, 14.570197396000026], [121.06603796700006, 14.567436069000053], [121.05524282700003, 14.567005092000045], [121.05816440000001, 14.577301557000055]]]]}'), 4326) WHERE name = 'Kapitolyo';

UPDATE barangays SET centroid_lon = 121.07817387025005, centroid_lat = 14.558942665500055 WHERE name = 'Malinao';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07657426800006, 14.560762054000065], [121.08428635300004, 14.556901891000052], [121.07526059200006, 14.557344663000038], [121.07657426800006, 14.560762054000065]]]]}'), 4326) WHERE name = 'Malinao';

UPDATE barangays SET centroid_lon = 121.09334550828576, centroid_lat = 14.60353701114291 WHERE name = 'Manggahan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.10075192300008, 14.612831706000065], [121.10944086300003, 14.59725558100007], [121.08246126800009, 14.592588593000073], [121.08280987, 14.603097099000024], [121.089989005, 14.599246040000025], [121.08721370600006, 14.606908353000051], [121.10075192300008, 14.612831706000065]]]]}'), 4326) WHERE name = 'Manggahan';

UPDATE barangays SET centroid_lon = 121.08788065380008, centroid_lat = 14.576148768800056 WHERE name = 'Maybunga';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07857321600011, 14.576363689000061], [121.09584299900007, 14.581904328000064], [121.10176341700003, 14.57373194400003], [121.0846504210001, 14.572380194000061], [121.07857321600011, 14.576363689000061]]]]}'), 4326) WHERE name = 'Maybunga';

UPDATE barangays SET centroid_lon = 121.06649420400008, centroid_lat = 14.575847883800042 WHERE name = 'Oranbo';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.0683809630001, 14.579853986000046], [121.06822922700007, 14.57441431500007], [121.0664963260001, 14.570197396000026], [121.06098354100004, 14.574919736000027], [121.0683809630001, 14.579853986000046]]]]}'), 4326) WHERE name = 'Oranbo';

UPDATE barangays SET centroid_lon = 121.08587680025008, centroid_lat = 14.561459133250054 WHERE name = 'Palatiw';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.08412738400011, 14.559449225000037], [121.08460566500003, 14.564112382000076], [121.09064676800006, 14.562825701000065], [121.08412738400011, 14.559449225000037]]]]}'), 4326) WHERE name = 'Palatiw';

UPDATE barangays SET centroid_lon = 121.09714850380007, centroid_lat = 14.553266931600058 WHERE name = 'Pinagbuhatan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.08729891700011, 14.562671786000067], [121.09808476800004, 14.562368499000058], [121.10972207600003, 14.546624930000064], [121.1033378410001, 14.531997657000034], [121.08729891700011, 14.562671786000067]]]]}'), 4326) WHERE name = 'Pinagbuhatan';

UPDATE barangays SET centroid_lon = 121.05839262875008, centroid_lat = 14.566058322250058 WHERE name = 'Pineda';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.05139764300009, 14.567941174000055], [121.06603796700006, 14.567436069000053], [121.06473726200011, 14.560914872000069], [121.05139764300009, 14.567941174000055]]]]}'), 4326) WHERE name = 'Pineda';

UPDATE barangays SET centroid_lon = 121.0935014588572, centroid_lat = 14.589738460142915 WHERE name = 'Rosario';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.08246126800009, 14.592588593000073], [121.10944086300003, 14.59725558100007], [121.11044978200005, 14.592235448000054], [121.09281007800007, 14.59006290700006], [121.09430721000001, 14.580801088000044], [121.08257974300011, 14.582637011000031], [121.08246126800009, 14.592588593000073]]]]}'), 4326) WHERE name = 'Rosario';

UPDATE barangays SET centroid_lon = 121.07734949225008, centroid_lat = 14.564860483000047 WHERE name = 'Sagad';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07593627800009, 14.565176222000048], [121.0809881670001, 14.565260867000063], [121.07653724600004, 14.563828621000027], [121.07593627800009, 14.565176222000048]]]]}'), 4326) WHERE name = 'Sagad';

UPDATE barangays SET centroid_lon = 121.06101069040005, centroid_lat = 14.582523720200049 WHERE name = 'San Antonio';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.06163874900005, 14.590629007000075], [121.06366758000001, 14.578311044000031], [121.06098354100004, 14.574919736000027], [121.0571248330001, 14.578129807000039], [121.06163874900005, 14.590629007000075]]]]}'), 4326) WHERE name = 'San Antonio';

UPDATE barangays SET centroid_lon = 121.07529917475006, centroid_lat = 14.550852989500044 WHERE name = 'San Joaquin';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07006109200006, 14.552018898000028], [121.08029010300004, 14.552468622000049], [121.08078441200007, 14.546905540000068], [121.07006109200006, 14.552018898000028]]]]}'), 4326) WHERE name = 'San Joaquin';

UPDATE barangays SET centroid_lon = 121.07507745700005, centroid_lat = 14.55999709800004 WHERE name = 'San Jose';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07363093900005, 14.559233034000044], [121.07656158500004, 14.561339070000031], [121.07648636500005, 14.560183254000037], [121.07363093900005, 14.559233034000044]]]]}'), 4326) WHERE name = 'San Jose';

UPDATE barangays SET centroid_lon = 121.08923941325008, centroid_lat = 14.565536195000064 WHERE name = 'San Miguel';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.0809881670001, 14.565260867000063], [121.0968965510001, 14.569254547000071], [121.09808476800004, 14.562368499000058], [121.0809881670001, 14.565260867000063]]]]}'), 4326) WHERE name = 'San Miguel';

UPDATE barangays SET centroid_lon = 121.08075298825005, centroid_lat = 14.559510127750059 WHERE name = 'San Nicolas';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07657426800006, 14.560762054000065], [121.08522875900007, 14.559030564000068], [121.08463465800003, 14.557485839000037], [121.07657426800006, 14.560762054000065]]]]}'), 4326) WHERE name = 'San Nicolas';

UPDATE barangays SET centroid_lon = 121.07887924350004, centroid_lat = 14.563158082250041 WHERE name = 'Santa Cruz';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07828274500002, 14.563926404000028], [121.08087738400002, 14.56188261400007], [121.0780741000001, 14.562896907000038], [121.07828274500002, 14.563926404000028]]]]}'), 4326) WHERE name = 'Santa Cruz';

UPDATE barangays SET centroid_lon = 121.10089994240009, centroid_lat = 14.584374428600052 WHERE name = 'Santa Lucia';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.0932642680001, 14.590032054000062], [121.10864271800006, 14.587715427000035], [121.10835392400008, 14.579272341000035], [121.1009745340001, 14.574820267000064], [121.0932642680001, 14.590032054000062]]]]}'), 4326) WHERE name = 'Santa Lucia';

UPDATE barangays SET centroid_lon = 121.06806276825006, centroid_lat = 14.557719539250044 WHERE name = 'Santa Rosa';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.06702392700004, 14.558661451000035], [121.07132935800007, 14.555824655000038], [121.06687386100009, 14.55773060000007], [121.06702392700004, 14.558661451000035]]]]}'), 4326) WHERE name = 'Santa Rosa';

UPDATE barangays SET centroid_lon = 121.08061634900005, centroid_lat = 14.562738004000039 WHERE name = 'Santo Tomas';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07828274500002, 14.563926404000028], [121.08180884700005, 14.562996418000068], [121.08409105900012, 14.56010279000003], [121.07828274500002, 14.563926404000028]]]]}'), 4326) WHERE name = 'Santo Tomas';

UPDATE barangays SET centroid_lon = 121.08634865280007, centroid_lat = 14.618054779200042 WHERE name = 'Santolan';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.08424756200009, 14.624098637000031], [121.092699777, 14.621755060000055], [121.09167848400011, 14.60655525900006], [121.07886987900008, 14.613766303000034], [121.08424756200009, 14.624098637000031]]]]}'), 4326) WHERE name = 'Santolan';

UPDATE barangays SET centroid_lon = 121.07288192625006, centroid_lat = 14.555995979000045 WHERE name = 'Sumilang';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.07132935800007, 14.555824655000038], [121.07519298500006, 14.557364556000039], [121.07367600400005, 14.554970050000065], [121.07132935800007, 14.555824655000038]]]]}'), 4326) WHERE name = 'Sumilang';

UPDATE barangays SET centroid_lon = 121.07036716775008, centroid_lat = 14.584753745500052 WHERE name = 'Ugong';
UPDATE barangays_geom SET geom = ST_SetSRID(ST_GeomFromGeoJSON('{"type": "MultiPolygon", "coordinates": [[[[121.06178426800011, 14.590462054000056], [121.08351133100007, 14.587895976000027], [121.07438880400002, 14.570194898000068], [121.06178426800011, 14.590462054000056]]]]}'), 4326) WHERE name = 'Ugong';
