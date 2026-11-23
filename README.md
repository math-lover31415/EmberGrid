# Project Description
Ember Grid, is a interactive web application designed to predict, visualize, and monitor forest fire vulnerabilities in real-time using advanced data analytics and predictive modeling.This platform will provide an intuitive dashboard that features dynamic, predictive heatmaps pointing out areas at high risk of catching wildfires. It serves as a vital tool for environmentalists, emergency response teams, and the general public to anticipate disasters before they ignite.

# Team Dolorem Ipsum
- Md. Zahid Hussain (26M0766)
- Pradyumn R Pai (26M0760)
- Giriraj Sahu (26M0764)

# Folder Structure

```
EmberGrid/
├── backend/                 # Flask REST API, database and data pipeline
│   └── app/                 # Application package (app factory, config, error handling)
│       ├── models/          # Database tables (SQLAlchemy ORM): cells, daily features, fire events, predictions, users
│       ├── routes/          # HTTP endpoints under /api/v1: auth, heatmap, cells, history
│       ├── services/        # Business logic behind the routes (queries, heatmaps, auth, security)
│       ├── jobs/            # Data pipeline: fetch fire + weather data, compute FWI, run daily predictions
│       ├── ml/              # Trained fire-risk model and the code that loads it
│       └── utils/           # Shared helpers: grid cell IDs, query-param parsing, data date range
│
├── frontend/                # React single-page app (dashboard + interactive map)
│   └── src/
│       ├── pages/           # Top-level pages: home dashboard, login, register
│       ├── components/      # UI components: map explorer, heatmap layers, cell detail panels
│       ├── context/         # Shared app state (logged-in user)
│       └── services/        # API client for talking to the backend
│
└── model/                   # Data preparation, exploratory analysis and model training (notebooks + scripts)
```

# Tools Used

### Backend
| Tool | Purpose |
|------|---------|
| Python 3.11 | Language |
| Flask | REST API framework |
| Flask-SQLAlchemy / SQLAlchemy | ORM and database queries |
| PostgreSQL + psycopg2 | Database and driver |
| PyJWT | Access/refresh tokens for authentication |
| pwdlib (Argon2) | Password hashing |
| Flask-CORS, Flask-Compress | Cross-origin requests and gzip responses |
| pandas, NumPy | Data processing in the ingestion jobs |
| requests | Calls to the NASA FIRMS and Open-Meteo APIs |
| scikit-learn | Loads the trained model and runs predictions |

### Frontend
| Tool | Purpose |
|------|---------|
| React 18 | UI library |
| React Router | Page routing (home, login, register) |
| MapLibre GL JS | Interactive map and heatmap layers |
| OpenStreetMap tiles | Base map |
| Nominatim (OpenStreetMap) | Place search / geocoding |
| Lucide React | Icons |
| Vite | Dev server and build tool |

### Model
| Tool | Purpose |
|------|---------|
| Jupyter Notebook | Data analysis and training |
| pandas, NumPy | Data cleaning and feature preparation |
| Matplotlib, Seaborn | Exploratory plots |
| scikit-learn | `RandomForestClassifier` (fire-risk model), metrics |
| pickle | Saves the trained model for the backend |

### Data Sources
| Source | Data |
|--------|------|
| NASA FIRMS (VIIRS) | Active fire detections |
| Open-Meteo (archive, ERA5 and forecast APIs) | Daily temperature, rainfall, humidity and wind |

# Disclaimer on AI usage:
AI was used for the following purposes:
- To look up syntax
- To help interpret NASA VIIRS data columns
- To generate suggestions for modelling viirs data
- To generate scripts for Data Ingestion and running the pipeline
- Building the ingestion data pipeline scripts end to end
- MapLibre map setup and rendering, turning Gridcell into GeoJSON
polygons and color scales.

