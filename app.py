"""
RetailMind — AI-Powered Retail Intelligence Platform
Production Flask Backend
"""
from flask import Flask, render_template, request, jsonify, session
import pandas as pd
import numpy as np
import os, uuid
from dotenv import load_dotenv

load_dotenv()

from models.demand_model import DemandPredictor
from utils.ai_engine import AIEngine

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "retailmind-secret-2025")

DATA_STORE  = {}   # sid → json string
MODEL_STORE = {}   # sid → DemandPredictor
AI          = AIEngine()

REQUIRED = ["Product","Category","Units_Sold","Current_Stock","Price","Competitor_Price"]

def sid():
    if "sid" not in session:
        session["sid"] = str(uuid.uuid4())
    return session["sid"]

# ── helpers ─────────────────────────────────────────────────────────────────
def load_df(session_id):
    raw = DATA_STORE.get(session_id)
    if raw is None:
        return None
    return pd.read_json(raw, orient="records")

def safe_int(v):
    try: return int(v)
    except: return 0

def safe_float(v):
    try: return round(float(v), 2)
    except: return 0.0

# ── routes ──────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/upload", methods=["POST"])
def upload():
    s = sid()
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f.filename.endswith(".csv"):
        return jsonify({"error": "Only CSV files accepted"}), 400
    try:
        df = pd.read_csv(f)
    except Exception as e:
        return jsonify({"error": f"CSV parse error: {e}"}), 400

    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        return jsonify({"error": f"Missing columns: {missing}"}), 400

    # Date features
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        df["Day"]   = df["Date"].dt.day.fillna(1).astype(int)
        df["Month"] = df["Date"].dt.month.fillna(1).astype(int)
        df["Year"]  = df["Date"].dt.year.fillna(2024).astype(int)
    else:
        df["Day"] = 1; df["Month"] = 1; df["Year"] = 2024

    pred = DemandPredictor()
    df   = pred.fit_predict(df)
    MODEL_STORE[s] = pred
    DATA_STORE[s]  = df.to_json(orient="records", date_format="iso")

    return jsonify({
        "success": True,
        "summary": {
            "rows":       safe_int(df.shape[0]),
            "products":   safe_int(df["Product"].nunique()),
            "categories": safe_int(df["Category"].nunique()),
            "has_date":   "Date" in df.columns,
        }
    })

@app.route("/api/dashboard")
def dashboard():
    s = sid()
    df = load_df(s)
    if df is None: return jsonify({"error":"No data"}), 400

    # KPIs
    prod = df.groupby("Product").agg(
        sold=("Units_Sold","sum"),
        stock=("Current_Stock","mean"),
        demand=("Predicted_Demand","mean"),
        price=("Price","mean"),
        comp=("Competitor_Price","mean"),
    ).reset_index()

    critical = int((prod["stock"] < prod["demand"] * 0.7).sum())
    kpis = {
        "total_rows":   safe_int(df.shape[0]),
        "products":     safe_int(prod.shape[0]),
        "categories":   safe_int(df["Category"].nunique()),
        "avg_stock":    safe_float(df["Current_Stock"].mean()),
        "avg_demand":   safe_float(df["Predicted_Demand"].mean()),
        "critical":     critical,
        "revenue_est":  safe_float((prod["sold"] * prod["price"]).sum()),
    }

    # Charts data
    top20 = prod.sort_values("sold", ascending=False).head(20)
    demand_stock = top20[["Product","sold","stock","demand"]].to_dict(orient="records")

    cat = df.groupby("Category")["Units_Sold"].sum().reset_index()
    cat.columns = ["category","sales"]

    daily = []
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"], errors="coerce")
        d = df.dropna(subset=["Date"]).groupby(df["Date"].dt.date)["Units_Sold"].sum()
        daily = [{"date": str(k), "sales": int(v)} for k,v in d.items()]

    price_cmp = prod.sort_values("price").head(20)[["Product","price","comp"]].to_dict(orient="records")

    return jsonify({
        "kpis": kpis,
        "demand_stock": demand_stock,
        "category_sales": cat.to_dict(orient="records"),
        "daily_trend": daily,
        "price_comparison": price_cmp,
    })

@app.route("/api/decisions")
def decisions():
    s = sid()
    df = load_df(s)
    if df is None: return jsonify({"error":"No data"}), 400
    result = AI.generate_decisions(df)
    return jsonify(result)

@app.route("/api/insights")
def insights():
    s = sid()
    df = load_df(s)
    if df is None: return jsonify({"error":"No data"}), 400
    result = AI.generate_insights(df)
    return jsonify(result)

@app.route("/api/copilot", methods=["POST"])
def copilot():
    s = sid()
    df = load_df(s)
    if df is None: return jsonify({"error":"No data"}), 400
    body = request.get_json() or {}
    q = body.get("question","").strip()
    if not q: return jsonify({"error":"Empty question"}), 400
    answer = AI.copilot(q, df)
    return jsonify({"answer": answer})

@app.route("/api/raw_data")
def raw_data():
    s = sid()
    df = load_df(s)
    if df is None: return jsonify({"error":"No data"}), 400
    cols = [c for c in df.columns if c not in ("Day","Month","Year")]
    return jsonify(df[cols].head(200).fillna("").to_dict(orient="records"))

if __name__ == "__main__":
    app.run(debug=True, port=5000)
