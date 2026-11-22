from flask import Flask
from flask_compress import Compress
from app.config import Config
from flask_cors import CORS
from sqlalchemy import text


from app.extensions import db

def create_app(env=None):
    app = Flask(__name__)
    app.config.from_object(Config)  
    
    db.init_app(app)
    Compress(app)
    CORS(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}},
         allow_headers=["Authorization", "Content-Type"], max_age=600)
    
    
    from app.routes.auth_routes import auth_bp
    from app.error import register_error_handlers
    register_error_handlers(app)
    
    from app.routes.cell_routes import cell_bp
    app.register_blueprint(cell_bp, url_prefix="/api/v1/cells")
    
    app.register_blueprint(auth_bp, url_prefix="/api/v1/auth")
    
    from app.routes.heatmap_routes import heatmap_bp
    app.register_blueprint(heatmap_bp, url_prefix="/api/v1/heatmap")
    
    
    from app.routes.history_routes import history_bp
    app.register_blueprint(history_bp, url_prefix="/api/v1/history")
    
    
    
    app.json.compact = True
    
    
    # @app.get("/health")
    # def health():
    #     return {"status": "ok"}, 200
    
    @app.get("/health")
    def health():
        try:
            db.session.execute(text("SELECT 1"))
        except Exception:
            app.logger.exception("health check: database unreachable")
            return {"status": "degraded", "database": "down"}, 503
        return {"status": "ok", "database": "up"}, 200

    return app
