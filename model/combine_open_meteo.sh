first=true
for file in data/open_meteo/era5*.csv; do
    if [ "$first" = true ]; then
        cat "$file" > data/open_meteo/combined.csv
        first=false
    else
        tail -n +2 "$file" >> data/open_meteo/combined.csv
    fi
done
