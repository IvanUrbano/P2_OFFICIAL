"""
Shared helpers for building TBInsight registry files: fictional patient identities
(Filipino naming conventions), dates of birth consistent with the recorded age, and
Case IDs in the system's format <FACILITY>-<D|M>-<YEAR>-<NNNNN> (PASIG_CLONE
services/caseIds.js). Deterministic: the same seed gives the same output.
"""
import datetime as dt
import json
import os
import random
import re

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]

# ---------- dates ----------

def parse_date(v):
    """The registry's date strings ('February 06, 2025', 'April 25, 2025 11:51') -> date, else None."""
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    written = re.match(r"^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})", s)
    iso = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    try:
        if written and written.group(1).capitalize() in MONTHS:
            d = dt.date(int(written.group(3)), MONTHS.index(written.group(1).capitalize()) + 1, int(written.group(2)))
        elif iso:
            d = dt.date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        else:
            return None
    except ValueError:
        return None
    # Same range the system accepts (dataCleaner.validYmd); "0205" for 2025 is a typo.
    return d if 1900 <= d.year <= 2100 else None


def fmt_date(d):
    """date -> 'February 06, 2025' (the registry's own format)."""
    return f"{MONTHS[d.month - 1]} {d.day:02d}, {d.year}"


def completed_years(born, on):
    age = on.year - born.year
    if (on.month, on.day) < (born.month, born.day):
        age -= 1
    return age


def valid_age(age):
    """The registry's Age as a number the system accepts (0-120), else None."""
    try:
        a = float(age)
    except (TypeError, ValueError):
        return None
    return a if 0 <= a <= 120 else None


def dob_for_age(age, on, rng):
    """
    A date of birth whose completed age on `on` is exactly int(age) (patientIdentity.computeAge).
    Infants are recorded in fractions of a year (0.08 = 1 month, 0.5 = 6 months): their birth
    date is placed that many months before `on`.
    """
    years = int(age)
    if years == 0 and age > 0:
        months = max(1, round(age * 12))
        born = on - dt.timedelta(days=round(months * 30.44) + rng.randint(-10, 10))
        born = min(born, on - dt.timedelta(days=1))
        born = max(born, _minus_years(on, 1) + dt.timedelta(days=1))
    else:
        latest = _minus_years(on, years)                                  # birthday today -> age
        earliest = _minus_years(on, years + 1) + dt.timedelta(days=1)      # one day short of age + 1
        born = earliest + dt.timedelta(days=rng.randrange((latest - earliest).days + 1))
    assert completed_years(born, on) == years, (born, on, age)
    return born


def _minus_years(d, years):
    try:
        return d.replace(year=d.year - years)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year - years, day=28)

# ---------- names ----------

# Common Philippine surnames, roughly in order of frequency (weight falls with rank).
SURNAMES = """Dela Cruz,Garcia,Reyes,Ramos,Mendoza,Santos,Flores,Gonzales,Bautista,Villanueva,Fernandez,
Cruz,De Guzman,Lopez,Perez,Castillo,Francisco,Rivera,Aquino,Castro,Sanchez,Torres,De Leon,Domingo,
Martinez,Rodriguez,Santiago,Soriano,Delos Santos,Diaz,Hernandez,Tolentino,Valdez,Ramirez,Morales,
Mercado,Tan,Aguilar,Navarro,Manalo,Gomez,Dizon,Del Rosario,Javier,Corpuz,Gutierrez,Salvador,Velasco,
Miranda,David,Salazar,Fernando,Robles,Pascual,Sarmiento,Alvarez,Jimenez,Lim,Mariano,Padilla,Vergara,
Ocampo,Panganiban,Marquez,Medina,Romero,Cortez,Estrada,Rosales,Andrada,Cabrera,Manalastas,Tiongson,
Pineda,Lacson,Agustin,Mangubat,Bernardo,Galang,Abad,Villarreal,Macaraeg,Nepomuceno,Lualhati,Sison,
Evangelista,Gatchalian,Mallari,Samonte,Saldana,Alonzo,Buenaventura,Ilagan,Lagman,Magbanua,Natividad,
Oliveros,Quiambao,Roxas,Tuazon,Umali,Vicente,Yap,Zamora,Abella,Barcelona,Cajucom,Dimaculangan,Esguerra,
Fajardo,Gallardo,Hilario,Isidro,Jacinto,Katigbak,Labrador,Macapagal,Nolasco,Obispo,Palma,Quiroz,
Rañola,Sablan,Tabora,Ubaldo,Valencia,Wenceslao,Ybañez,Zaragoza,Antonio,Belmonte,Catapang,Dimalanta,
Enriquez,Feliciano,Guevarra,Hidalgo,Ignacio,Legaspi,Mabini,Nuñez,Ortega,Peralta,Quinto,Rillo,Sumulong,
Tamayo,Valerio,Arceo,Bonifacio,Carpio,Dalisay,Espiritu,Gamboa,Lazaro,Magsaysay,Ong,Policarpio,Reyno,
Sevilla,Trinidad,Villaflor,Arcilla,Baluyot,Calderon,Dantes,Escobar,Fuentes,Gozon,Laxamana,Manansala""".replace("\n", "")
SURNAMES += "," + """Abaya,Abesamis,Abrenica,Acosta,Adriano,Agbayani,Agcaoili,Agoncillo,Alcantara,Alejandro,Almario,
Almonte,Alvarado,Amador,Ambrosio,Ancheta,Angeles,Apostol,Aragon,Arellano,Arevalo,Arguelles,Arriola,Asuncion,
Avila,Baclig,Bacani,Bagatsing,Balagtas,Balderama,Baltazar,Banaag,Barrientos,Basa,Batungbakal,Belen,Benitez,
Bernal,Biglang-awa,Blanco,Borja,Briones,Buendia,Bulatao,Bustamante,Caballero,Cabral,Cadiz,Calma,Camacho,
Campos,Canlas,Capili,Carandang,Carreon,Casas,Castañeda,Cayabyab,Chua,Coronel,Cuenca,Cunanan,Custodio,
Dabu,Dacanay,Dadivas,Dagdag,Dalusong,Danao,Dayrit,De Castro,De Jesus,De Lara,Dela Peña,Dela Rosa,
Del Mundo,Del Valle,Diokno,Dionisio,Doctor,Dumlao,Duque,Ebora,Eclarinal,Elizalde,Encarnacion,Ermita,
Escalante,Esteban,Eugenio,Fabian,Felix,Ferrer,Florendo,Fontanilla,Galvez,Gaspar,Gatdula,Geronimo,Gil,
Go,Granados,Guanzon,Guiao,Guinto,Habana,Herrera,Hizon,Ibañez,Imperial,Infante,Jamir,Jaramillo,Jose,
Julian,Kalaw,Lacsamana,Ladia,Lagdameo,Lamug,Lapid,Lardizabal,Lantin,Lazo,Leaño,Liwanag,Lorenzo,Lucero,
Luna,Mabanag,Macalintal,Madlangbayan,Magpantay,Malabanan,Malonzo,Mangahas,Manuel,Marcelo,Matias,Maximo,
Maglaya,Manalili,Mendiola,Mesina,Molina,Montemayor,Nacpil,Nario,Nicolas,Nieva,Ochoa,Olaguer,Olivares,
Onrubia,Ordoñez,Padua,Pagaduan,Palacios,Pamintuan,Paras,Pastrana,Patricio,Perlas,Ponce,Prado,Punzalan,
Quijano,Quimpo,Rabago,Ramento,Rances,Real,Recto,Regala,Resurreccion,Rico,Rivas,Rubio,Ruiz,Sabado,Sacdalan,
Salonga,Samson,San Jose,San Juan,San Pedro,Santillan,Saplala,Serrano,Sia,Silang,Simbulan,Siy,Solis,Sta. Maria,
Suarez,Sy,Tadeo,Talavera,Tanjuatco,Tecson,Tejada,Templo,Teves,Tinio,Tolosa,Tumang,Uy,Valenzuela,Vargas,
Velarde,Ventura,Vera,Villacorta,Villamor,Villegas,Yambao,Yulo,Zabala,Zulueta,Advincula,Babasa,Cabading,
Dagohoy,Dimaano,Eleazar,Gabriel,Gonzaga,Lagasca,Lumbao,Maderazo,Malit,Masangkay,Miclat,Nable,Nebrida,
Nisperos,Pacis,Pangilinan,Pilapil,Purisima,Rabino,Sarabia,Sevillano,Sindayen,Tagle,Tirona,Torralba,Turla,
Vasquez,Vidal,Viray,Abalos,Bañez,Cariño,Dela Fuente,Despuig,Estrella,Gacutan,Hermosa,Ilustre,Lagunzad,
Magno,Navarrete,Orbeta,Pacheco,Quisumbing,Sampang,Soliman,Tuason,Valmonte,Yumul,Alarcon,Bacolod,Carlos,
Dela Torre,Ebarle,Gavino,Lopena,Mananquil,Nazareno,Oropesa,Pelayo,Rosete,Segovia,Tablante,Yabut""".replace("\n", "")
SURNAMES = list(dict.fromkeys(s.strip() for s in SURNAMES.split(",") if s.strip()))

# First names by birth generation (born before 1965, 1965-84, 1985-99, 2000 and later).
FIRST = {
    "M": [
        "Jose,Juan,Pedro,Antonio,Ricardo,Rogelio,Eduardo,Ernesto,Romeo,Danilo,Rodolfo,Alfredo,Francisco,Manuel,Arturo,Renato,Felipe,Benjamin,Cesar,Teodoro,Leonardo,Domingo,Rolando,Virgilio,Gregorio",
        "Jun,Ronaldo,Edgardo,Joel,Michael,Ramon,Reynaldo,Rodel,Allan,Arnel,Noel,Marlon,Dennis,Jerry,Rommel,Nestor,Ferdinand,Alvin,Jonathan,Christopher,Wilfredo,Raymond,Rey,Gerardo,Rodrigo",
        "John Paul,Mark Anthony,Jayson,Christian,Mark,Kevin,Joshua,Jerome,Ryan,Jeffrey,Rodel,Jomar,Carlo,Paolo,John Mark,Joseph,Jericho,Erwin,Ronnel,Kenneth,Bryan,Ariel,Jhon,Marvin,Dexter",
        "Joshua,John Lloyd,Ivan,Nathaniel,Justin,Gabriel,Kurt,Angelo,Jhon Carlo,Prince,Kyle,Rhenz,Zian,Ezekiel,Lance,Jairus,Sean,Elijah,Clarence,Vince,Raffy,Aldrin,Mico,Jerome,Daniel",
    ],
    "F": [
        "Maria,Rosario,Josefina,Teresita,Corazon,Lourdes,Erlinda,Leticia,Remedios,Gloria,Carmelita,Norma,Luzviminda,Rosalinda,Estela,Aurora,Milagros,Perla,Adelaida,Cecilia,Natividad,Felicidad,Consolacion,Rosita,Editha",
        "Marilyn,Elizabeth,Maricel,Rowena,Jocelyn,Lorna,Marites,Analyn,Gemma,Rosemarie,Evelyn,Cristina,Ma. Theresa,Arlene,Sheryl,Liza,Jennifer,Grace,Annabelle,Lilibeth,Myrna,Vilma,Ruby,Susan,Rhodora",
        "Kristine,Mary Grace,Jessica,Princess,Michelle,Rachelle,Joanna,Angelica,Camille,Katherine,Jennylyn,Charmaine,Kimberly,Abigail,Mary Joy,Christine,Daisy,Lovely,April,Diana,Rica,Shiela,Joy,Ella,Nicole",
        "Angel,Princess,Althea,Andrea,Bea,Janelle,Kyla,Trisha,Samantha,Ashley,Hannah,Nicole,Sofia,Jasmine,Erica,Shane,Mikaela,Patricia,Chloe,Kristel,Aira,Danica,Rhianne,Zyra,Mae",
    ],
}
MORE_FIRST = {
    "M": [
        "Agapito,Alberto,Anastacio,Andres,Apolinario,Bartolome,Bienvenido,Candido,Conrado,Crisanto,Dionisio,Efren,Emiliano,Eusebio,Fausto,Fortunato,Generoso,Hermogenes,Honorio,Ignacio,Isidro,Jacinto,Leopoldo,Lorenzo,Marcelino,Melchor,Nicanor,Pablo,Patricio,Primitivo,Quirino,Restituto,Rufino,Santiago,Saturnino,Severino,Simeon,Tomas,Venancio,Wenceslao",
        "Abner,Adonis,Alexander,Amado,Arnold,Benedicto,Bernardo,Carlito,Celso,Dante,Delfin,Elmer,Emmanuel,Ferdinand,Florencio,Gilbert,Glenn,Herminio,Isagani,Jaime,Jessie,Joey,Lito,Lorenzo,Melvin,Nelson,Orlando,Oscar,Rafael,Randy,Reggie,Rene,Robert,Ronnie,Ruben,Samuel,Tirso,Valentin,Victor,Wilson",
        "Aaron,Adrian,Alfie,Anthony,Arvin,Benedict,Bernard,Cedric,Darwin,Dominic,Edison,Eldrin,Francis,Gerald,Harold,Ian,Jake,Jasper,Jeric,Jesus,Jovel,Junjun,Karl,Lemuel,Leo,Lester,Marco,Melchor,Neil,Niño,Oliver,Patrick,Ralph,Randolph,Reymart,Roldan,Romnick,Russel,Ted,Wendell",
        "Aiden,Allen,Andrei,Axel,Bench,Bryle,Carl,Cyrus,Dave,Denver,Drei,Ethan,Francis Gabriel,Gian,Hans,Ian Paul,Jacob,Jan Lester,Jay-ar,Jefferson,Jian,Jude,Kian,Kristoffer,Luis,Marc,Matthew,Miguel,Nathan,Neo,Paul,Rafael,Renz,Reymond,Rhey,Simon,Stephen,Tristan,Zachary,Zeus",
    ],
    "F": [
        "Agnes,Amparo,Anastacia,Apolonia,Asuncion,Beatriz,Brigida,Candelaria,Caridad,Catalina,Concepcion,Crispina,Dolores,Elena,Encarnacion,Esperanza,Eufemia,Filomena,Florentina,Generosa,Gregoria,Herminia,Ignacia,Isabel,Juana,Leonora,Lucia,Magdalena,Marcela,Nieves,Ofelia,Paciencia,Pilar,Purificacion,Rufina,Salud,Soledad,Teodora,Trinidad,Victoria",
        "Adelfa,Alma,Amelia,Aida,Beth,Carmen,Charito,Cora,Dalisay,Delia,Edna,Elvira,Emma,Fe,Flordeliza,Girlie,Imelda,Irene,Jovita,Leonila,Linda,Lolita,Lydia,Magdalena,Marivic,Merlinda,Minda,Nenita,Nora,Olivia,Pacita,Rebecca,Rosalie,Rowena,Shirley,Teresa,Virginia,Wilma,Yolanda,Zenaida",
        "Aileen,Alyssa,Anne,Bernadette,Carla,Cherry,Clarissa,Donna,Eileen,Ellaine,Fatima,Frances,Geraldine,Hazel,Ivy,Jamaica,Janine,Jasmine,Jenny,Joanne,Karen,Leah,Lyka,Marian,Marjorie,Melody,Nina,Pamela,Pauline,Regine,Rhea,Rose Ann,Sarah,Sharon,Stephanie,Thea,Vanessa,Veronica,Weng,Yvonne",
        "Alexa,Alyanna,Ayesha,Bianca,Cassandra,Czarina,Dhanica,Eunice,Faith,Gwyneth,Hailey,Isabella,Jaira,Jhoanna,Julia,Kaycee,Keziah,Lianne,Louise,Maxine,Mia,Nadine,Precious,Queenie,Rhian,Sabrina,Sheena,Shaira,Sophia,Stacy,Tricia,Unice,Venice,Xyza,Yna,Ysabel,Zia,Kristine Joy,Angel Mae,Mary Ann",
    ],
}
FIRST = {sex: [[n.strip() for n in g.split(",")] + [n.strip() for n in MORE_FIRST[sex][i].split(",")]
               for i, g in enumerate(gens)] for sex, gens in FIRST.items()}
FIRST = {sex: [list(dict.fromkeys(g)) for g in gens] for sex, gens in FIRST.items()}
# Second given names for compound first names ("Maria Luisa", "John Rey").
SECOND_GIVEN = {
    "M": "Rey,Paul,Mark,Carlo,Miguel,Jose,Antonio,Luis,Angelo,Vincent,Lloyd,Emmanuel,Gabriel,Rafael,James".split(","),
    "F": "Luisa,Cristina,Elena,Isabel,Theresa,Grace,Joy,Mae,Ann,Rose,Liza,Clarisse,Victoria,Andrea,Camille".split(","),
}
COMPOUND_PREFIX = {"M": ["John", "Jose", "Juan", "Mark", "Carlo"], "F": ["Maria", "Ma.", "Mary", "Anna", "Rose"]}


def _generation(birth_year):
    return 0 if birth_year < 1965 else 1 if birth_year < 1985 else 2 if birth_year < 2000 else 3


class IdentityRegistry:
    """Hands out fictional, unique (last name, first name, date of birth) identities."""

    def __init__(self, path, seed):
        self.path = path
        self.used = set(json.load(open(path))) if os.path.exists(path) else set()
        self.names = {k.rsplit("|", 1)[0] for k in self.used}
        self.rng = random.Random(seed)
        n = len(SURNAMES)
        # Frequent names first with a long, flat tail: no surname dominates the list.
        self.surname_weights = [1 / (i + 60) for i in range(n)]

    def surname(self, exclude=None):
        while True:
            s = self.rng.choices(SURNAMES, self.surname_weights)[0]
            if s != exclude:
                return s

    def first_name(self, sex, birth_year):
        pool = FIRST[sex][_generation(birth_year)]
        if self.rng.random() < 0.18:  # compound given name, common across generations
            return f"{self.rng.choice(COMPOUND_PREFIX[sex])} {self.rng.choice(SECOND_GIVEN[sex])}"
        return self.rng.choice(pool)

    def new(self, sex, age, on):
        """{last, first, middle, suffix, dob} for a patient of `sex` aged `age` on date `on`."""
        sex = "M" if str(sex).upper().startswith("M") else "F"
        age = valid_age(age)
        for attempt in range(2000):
            # An impossible recorded age (e.g. 1087) gives no birth date: the record is left
            # for a person to correct rather than given an invented one.
            dob = dob_for_age(age, on, self.rng) if age is not None and on else None
            last = self.surname()
            first = self.first_name(sex, dob.year if dob else 1980)
            name = f"{last.lower()}|{first.lower()}"
            key = f"{name}|{dob.isoformat() if dob else 'none'}"
            # The full name itself must be unused (only after many tries may it repeat with
            # a different birth date, as happens with real namesakes).
            if key in self.used or (name in self.names and attempt < 1500):
                continue
            self.used.add(key)
            self.names.add(name)
            middle = "" if self.rng.random() < 0.03 else self.surname(exclude=last)
            suffix = ""
            if sex == "M":
                r = self.rng.random()
                suffix = "Jr." if r < 0.04 else "III" if r < 0.047 else "Sr." if (r < 0.052 and (age or 0) >= 40) else ""
            return {"last": last, "first": first, "middle": middle, "suffix": suffix, "dob": dob}
        raise RuntimeError("could not find a unique identity")

    def save(self):
        json.dump(sorted(self.used), open(self.path, "w"))

# ---------- Case IDs ----------

def facility_code(treatment, screening, resolved):
    """Treatment facility's code; screening facility's when the treatment one is unknown; else UNK."""
    for name in (treatment, screening):
        f = resolved.get(str(name).strip()) if name else None
        if f and f.get("code"):
            return f["code"]
    return "UNK"


def assign_case_ids(rows, kind, counters):
    """
    rows: [{"idx", "code", "dx"}] -> {idx: case_id}. Numbered per facility + type + year of
    diagnosis, in order of diagnosis date (then original row order). `counters` holds the last
    number used per facility/type/year ACROSS files (a 2025 file can hold a case diagnosed in
    2022), so numbering continues instead of repeating; it is updated in place.
    """
    letter = {"DSTB": "D", "MN": "M"}[kind]
    out = {}
    for r in sorted(rows, key=lambda r: (r["dx"], r["idx"])):
        key = f"{r['code']}-{letter}-{r['dx'].year}"
        counters[key] = counters.get(key, 0) + 1
        out[r["idx"]] = f"{key}-{counters[key]:05d}"
    return out


def load_counters(path):
    return json.load(open(path)) if os.path.exists(path) else {}


def save_counters(path, counters):
    json.dump(counters, open(path, "w"), indent=0, sort_keys=True)
