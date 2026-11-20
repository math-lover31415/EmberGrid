first=true
for file in data/viirs/viirs*.csv; do
    if [ "$first" = true ]; then
        cat "$file" > data/viirs/combined.csv
        first=false
    else
        tail -n +2 "$file" >> data/viirs/combined.csv
    fi
done
