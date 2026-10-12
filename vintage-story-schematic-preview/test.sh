mkdir -p public/schematics
cp *.html public/
cp schematics/*.json public/schematics/
cp -r icons/ public/

python3 -m http.server --directory public