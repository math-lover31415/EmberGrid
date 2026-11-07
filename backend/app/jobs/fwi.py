
import math

# effective day-length factors by month (index 0 = January)
_LE = [6.5, 7.5, 9.0, 12.8, 13.9, 13.9, 12.4, 10.9, 9.2, 8.0, 7.0, 6.0]      # DMC
_LF = [-1.6, -1.6, -1.6, 0.9, 3.8, 5.8, 6.4, 5.0, 2.4, 0.4, -1.6, -1.6]        # DC

START = (85.0, 6.0, 15.0)     # FFMC, DMC, DC start-up values


def ffmc(f0, t, h, w, rain):
    mo = 147.2 * (101.0 - f0) / (59.5 + f0)
    if rain > 0.5:
        rf = rain - 0.5
        mo += 42.5 * rf * math.exp(-100.0 / (251.0 - mo)) * (1.0 - math.exp(-6.93 / rf))
        if mo > 150.0:
            mo += 0.0015 * (mo - 150.0) ** 2 * math.sqrt(rf)
        mo = min(mo, 250.0)
    ed = 0.942 * h ** 0.679 + 11.0 * math.exp((h - 100.0) / 10.0) + 0.18 * (21.1 - t) * (1.0 - math.exp(-0.115 * h))
    if mo > ed:
        ko = 0.424 * (1.0 - (h / 100.0) ** 1.7) + 0.0694 * math.sqrt(w) * (1.0 - (h / 100.0) ** 8)
        m = ed + (mo - ed) * 10.0 ** (-(ko * 0.581 * math.exp(0.0365 * t)))
    else:
        ew = 0.618 * h ** 0.753 + 10.0 * math.exp((h - 100.0) / 10.0) + 0.18 * (21.1 - t) * (1.0 - math.exp(-0.115 * h))
        if mo < ew:
            k1 = 0.424 * (1.0 - ((100.0 - h) / 100.0) ** 1.7) + 0.0694 * math.sqrt(w) * (1.0 - ((100.0 - h) / 100.0) ** 8)
            m = ew - (ew - mo) * 10.0 ** (-(k1 * 0.581 * math.exp(0.0365 * t)))
        else:
            m = mo
    return min(max(59.5 * (250.0 - m) / (147.2 + m), 0.0), 101.0)


def dmc(p0, t, h, rain, month):
    t = max(t, -1.1)
    rk = 1.894 * (t + 1.1) * (100.0 - h) * _LE[month - 1] * 0.0001
    if rain > 1.5:
        rw = 0.92 * rain - 1.27
        wmi = 20.0 + 280.0 / math.exp(0.023 * p0)
        if p0 <= 33.0:
            b = 100.0 / (0.5 + 0.3 * p0)
        elif p0 <= 65.0:
            b = 14.0 - 1.3 * math.log(p0)
        else:
            b = 6.2 * math.log(p0) - 17.2
        wmr = wmi + 1000.0 * rw / (48.77 + b * rw)
        pr = max(43.43 * (5.6348 - math.log(wmr - 20.0)), 0.0)
    else:
        pr = p0
    return pr + rk


def dc(d0, t, rain, month):
    t = max(t, -2.8)
    pe = max((0.36 * (t + 2.8) + _LF[month - 1]) / 2.0, 0.0)
    if rain > 2.8:
        rd = 0.83 * rain - 1.27
        qo = 800.0 * math.exp(-d0 / 400.0)
        dr = max(400.0 * math.log(800.0 / (qo + 3.937 * rd)), 0.0)
    else:
        dr = d0
    return dr + pe


def isi(f, w):
    m = 147.2 * (101.0 - f) / (59.5 + f)
    return 0.208 * math.exp(0.05039 * w) * 91.9 * math.exp(-0.1386 * m) * (1.0 + m ** 5.31 / 4.93e7)


def bui(p, d):
    if p == 0.0 and d == 0.0:
        return 0.0
    if p <= 0.4 * d:
        u = 0.8 * p * d / (p + 0.4 * d)
    else:
        u = p - (1.0 - 0.8 * d / (p + 0.4 * d)) * (0.92 + (0.0114 * p) ** 1.7)
    return max(u, 0.0)


def fwi(i, u):
    fd = 0.626 * u ** 0.809 + 2.0 if u <= 80.0 else 1000.0 / (25.0 + 108.64 * math.exp(-0.023 * u))
    b = 0.1 * i * fd
    return math.exp(2.72 * (0.434 * math.log(b)) ** 0.647) if b > 1.0 else b


def step(state, t, h, w, rain, month):
    f0, p0, d0 = state
    f = ffmc(f0, t, h, w, rain)
    p = dmc(p0, t, h, rain, month)
    d = dc(d0, t, rain, month)
    i, u = isi(f, w), bui(p, d)
    return (f, p, d), i, u, fwi(i, u)


def magnus(t):
    return math.exp(17.625 * t / (243.04 + t))


def noon_inputs(tmax, tmin, rh_mean, wind_mean, wind_max, wind_unit="ms"):
    h = min(100.0 * magnus(tmin) / magnus(tmax), rh_mean)
    h = min(max(h, 1.0), 100.0)
    k = 3.6 if wind_unit == "ms" else 1.0
    return tmax, h, 0.5 * (wind_mean + wind_max) * k


def series(rows, wind_unit="ms"):
    state, prev = START, None
    for r in rows:
        if prev is not None and (r["date"] - prev).days != 1:
            state = START
        prev = r["date"]
        t, h, w = noon_inputs(r["tmax"], r["tmin"], r["rh_mean"], r["wind_mean"], r["wind_max"], wind_unit)
        state, i, u, f = step(state, t, h, w, max(r["rain"], 0.0), r["date"].month)
        yield r["date"], state[0], state[1], state[2], i, u, f