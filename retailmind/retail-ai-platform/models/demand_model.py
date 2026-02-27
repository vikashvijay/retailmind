"""
Demand Prediction Model
Ensemble: Gradient Boosting + Random Forest (CPU-friendly, production-grade)
Falls back to TF MLP when enough data exists.
All technical internals — never exposed to the UI.
"""
import numpy as np
import pandas as pd
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import warnings; warnings.filterwarnings("ignore")

try:
    import tensorflow as tf
    from tensorflow import keras
    TF_AVAILABLE = True
except:
    TF_AVAILABLE = False


class DemandPredictor:
    def __init__(self):
        self.model        = None
        self.scaler       = StandardScaler()
        self.label_enc    = LabelEncoder()
        self.feat_names   = []
        self.metrics_     = {}
        self.importances_ = {}
        self._prod_map    = {}  # product → predicted demand

    def _features(self, df: pd.DataFrame, fit=False) -> np.ndarray:
        d = df.copy()
        cats = d["Category"].fillna("Other")
        if fit:
            self.label_enc.fit(cats)
        d["cat_enc"] = self.label_enc.transform(cats)

        d["log_stock"] = np.log1p(d["Current_Stock"].clip(0))
        d["log_price"] = np.log1p(d["Price"].clip(0))
        d["log_comp"]  = np.log1p(d["Competitor_Price"].clip(0))
        d["price_sens"]= d["Price"] / (d["Competitor_Price"] + 1e-6)
        d["price_gap"] = d["Competitor_Price"] - d["Price"]
        d["stk_price"] = d["Current_Stock"] / (d["Price"] + 1e-6)
        d["m_sin"]     = np.sin(2 * np.pi * d["Month"] / 12)
        d["m_cos"]     = np.cos(2 * np.pi * d["Month"] / 12)

        self.feat_names = [
            "log_stock","log_price","log_comp","cat_enc",
            "m_sin","m_cos","price_sens","price_gap","stk_price"
        ]
        X = d[self.feat_names].values.astype(np.float32)
        return np.nan_to_num(X, nan=0., posinf=0., neginf=0.)

    def _build_mlp(self, dim):
        inp = keras.Input(shape=(dim,))
        x = keras.layers.Dense(256, activation="relu",
                               kernel_regularizer=keras.regularizers.l2(1e-4))(inp)
        x = keras.layers.BatchNormalization()(x)
        x = keras.layers.Dropout(0.3)(x)
        x = keras.layers.Dense(128, activation="relu")(x)
        x = keras.layers.BatchNormalization()(x)
        x = keras.layers.Dropout(0.2)(x)
        x = keras.layers.Dense(64, activation="relu")(x)
        x = keras.layers.Dropout(0.1)(x)
        x = keras.layers.Dense(1)(x)
        m = keras.Model(inp, x)
        m.compile(optimizer=keras.optimizers.Adam(5e-4), loss="huber", metrics=["mae"])
        return m

    def fit_predict(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.copy()
        # Aggregate to product level (avoids repeated-row bias)
        agg = df.groupby("Product").agg(
            Category=("Category","first"),
            Current_Stock=("Current_Stock","mean"),
            Price=("Price","mean"),
            Competitor_Price=("Competitor_Price","mean"),
            Month=("Month","median"),
            Day=("Day","median"),
            Units_Sold=("Units_Sold","mean"),
        ).reset_index()

        n = len(agg)
        if n < 4:
            df["Predicted_Demand"] = df["Units_Sold"]
            self.metrics_ = {"mae":0,"r2":1}
            return df

        X    = self._features(agg, fit=True)
        y    = np.clip(agg["Units_Sold"].values.astype(np.float32), 0, None)
        test = min(0.2, max(0.15, 10/n))

        X_tr, X_te, y_tr, y_te = (train_test_split(X, y, test_size=test, random_state=42)
                                   if n >= 10 else (X, X, y, y))

        X_tr_s = self.scaler.fit_transform(X_tr)
        X_te_s = self.scaler.transform(X_te)
        X_all  = self.scaler.transform(X)

        imp = {}
        if TF_AVAILABLE and n >= 25:
            m = self._build_mlp(X_tr_s.shape[1])
            vs = 0.15 if len(X_tr_s) > 20 else 0.0
            m.fit(X_tr_s, y_tr,
                  epochs=min(200, n*4), batch_size=max(4, min(16, n//4)),
                  validation_split=vs,
                  callbacks=[
                      keras.callbacks.EarlyStopping(patience=15, restore_best_weights=True,
                                                    monitor="val_loss" if vs>0 else "loss"),
                      keras.callbacks.ReduceLROnPlateau(patience=7, factor=0.5),
                  ], verbose=0)
            self.model = m
            p_all = np.clip(m.predict(X_all, verbose=0).flatten(), 0, None)
            p_te  = np.clip(m.predict(X_te_s, verbose=0).flatten(), 0, None)
            # permutation importance
            base = mean_absolute_error(y_te, p_te)
            for i, fn in enumerate(self.feat_names):
                Xp = X_te_s.copy(); np.random.shuffle(Xp[:,i])
                imp[fn] = max(0., mean_absolute_error(y_te, m.predict(Xp, verbose=0).flatten()) - base)
        else:
            gb = GradientBoostingRegressor(n_estimators=300, max_depth=4,
                                           learning_rate=0.03, subsample=0.8, random_state=42)
            rf = RandomForestRegressor(n_estimators=200, random_state=42, n_jobs=-1)
            gb.fit(X_tr_s, y_tr); rf.fit(X_tr_s, y_tr)
            self.model = (gb, rf)
            p_all = np.clip(gb.predict(X_all)*0.6 + rf.predict(X_all)*0.4, 0, None)
            p_te  = np.clip(gb.predict(X_te_s)*0.6 + rf.predict(X_te_s)*0.4, 0, None)
            imp   = dict(zip(self.feat_names, gb.feature_importances_))

        mae = float(mean_absolute_error(y_te, p_te))
        r2  = float(r2_score(y_te, p_te)) if len(y_te)>1 else 1.
        self.metrics_ = {"mae": round(mae,2), "r2": round(r2,4)}

        tot = sum(imp.values()) + 1e-9
        self.importances_ = {k: round(v/tot*100,1) for k,v in sorted(imp.items(), key=lambda x:-x[1])}

        prod_pred = dict(zip(agg["Product"].values, p_all))
        df["Predicted_Demand"] = df["Product"].map(prod_pred).fillna(df["Units_Sold"])
        return df
