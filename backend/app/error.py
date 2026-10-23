from flask import jsonify
from sqlalchemy.exc import SQLAlchemyError
from werkzeug.exceptions import HTTPException

class APIError(Exception):
    status_code= 400
    
    def __init__(self,message,status_code=None):
        super().__init__(message)
        self.message = message
        if status_code:
            self.status_code= status_code
    
    
class NotFound(APIError):
    status_code,code=404,"not_found"

class Conflict(APIError):
    status_code, code = 409, "conflict"

def _body(code, message):
    return jsonify({"error": {"code": code, "message": message}})



def register_error_handlers(app):
    @app.errorhandler(APIError)
    def api_error(err: APIError):
        return _body(err.code,err.message), err.status_code
    
    @app.errorhandler(SQLAlchemyError)
    def database_error():
        return _body("database_error", "Unable to retrieve data at this time."), 500
    
    @app.errorhandler(HTTPException)
    def http_error(e):
        return _body(e.name.lower().replace(" ", "_"), e.description), e.code
    
    @app.errorhandler(Exception)
    def unexpected(e):
        return _body("internal_server_error", "Something went wrong."), 500