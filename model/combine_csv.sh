first=true
for file in data/viirs*.csv; do
    if [ "$file" = "data/combined.csv" ]; then
        continue
    elif [ "$first" = true ]; then
        cat "$file" > data/combined.csv
        is_first=false
    else
        tail -n +2 "$file" >> data/combined.csv
    fi
done
