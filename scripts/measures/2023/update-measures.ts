const performanceYear = 2023
const measuresFileName = `../../../measures/${performanceYear}/measures-data.json`;
const changesDir = `../../../updates/measures/${performanceYear}/`;

import _ from 'lodash';
import fs from 'fs';
import parse from 'csv-parse/lib/sync';

import changelog from '../../../updates/measures/2023/Changelog.json';
import measuresJson from '../../../measures/2023/measures-data.json';

import { initValidation } from '../lib/validation-util';


let numOfNewChangeFiles = 0;

const BASE_CSV_COLUMN_NAMES = {
    'title': 'title',
    'description': 'description',
    'measureId': 'measure_id'
}

const IA_CSV_COLUMN_NAMES = {
    ...BASE_CSV_COLUMN_NAMES,
    'weight': 'weight',
    'subcategoryId': 'subcategory_name'
};

const PI_CSV_COLUMN_NAMES = {
    ...BASE_CSV_COLUMN_NAMES,
    'required': 'required',
    'isRequired': 'required',
    'metricType': 'name',
    'isBonus': 'bonus',
    'reportingCategory': 'reporting_category',
    'substitutes': 'substitutes',
    'exclusion': 'exclusions',
};

//hard-type the changelog json to handle empty array (when the PY is first created).
const typedChangelog: string[] = changelog;

function makeChanges() {
    const files = fs.readdirSync(changesDir);

    files.forEach(fileName => {
        if(fileName != 'Changelog.json') {
            if(!typedChangelog.includes(fileName)) {
                numOfNewChangeFiles++;
                updateMeasuresWithChangeFile(fileName)
            }
        }
    });

    if(numOfNewChangeFiles > 0) {
        writeToFile(measuresJson, measuresFileName);
    } else {
        console.info(
            '\x1b[33m%s\x1b[0m', 
            `No new change files found.`,
        );
    }
}

function convertCsvToJson(fileName: string) {
    const csv = fs.readFileSync(`${changesDir}${fileName}`, 'utf8');
    const parsedCsv = parse(csv, {columns: true});

    return parsedCsv.map((row) => {
        const measure = {};
        measure['category'] = row['category'].toLowerCase();
        let csvColumnNames;
        switch (measure['category']) {
          case 'ia':
              csvColumnNames = IA_CSV_COLUMN_NAMES;
              break;
          case 'pi':
              csvColumnNames = PI_CSV_COLUMN_NAMES;
              break;
        }
        _.each(csvColumnNames, (columnName, measureKeyName) => {
          if(row[columnName]) {
              measure[measureKeyName] = row[columnName];
          }
        });
        
        return measure;
    });
}

function updateMeasuresWithChangeFile(fileName: string) {
    const changeData = convertCsvToJson(fileName);
    let numOfFailures = 0;

    for (let i = 0; i < changeData.length; i++) {
        const change = changeData[i];

        if(change.category) {
            const validate = initValidation(change.category);

            if (validate(change)) {
                updateMeasure(change);
            } else {
                numOfFailures++;
                console.log(validate.errors)
            }
        } else {
            numOfFailures++;
            console.error(
                '\x1b[31m%s\x1b[0m', 
                `[ERROR]: '${fileName}': category is required.`,
            );
        }
    }

    if(numOfFailures === 0) {
        updateChangeLog(fileName);
        console.info(
            '\x1b[32m%s\x1b[0m', 
            `File '${fileName}' successfully ingested into measures-data ${performanceYear}`,
        );
    } else {
        console.error(
            '\x1b[31m%s\x1b[0m', 
            `[ERROR]: Some changes failed for file '${fileName}'. More info logged above.`,
        );
    }
}

function updateChangeLog(fileName: string) {
    typedChangelog.push(fileName);
    writeToFile(typedChangelog, `${changesDir}Changelog.json`);
}

function writeToFile(file: any, fileName: string) {
    fs.writeFile(fileName, JSON.stringify(file, null, 2), function writeJSON(err) {
        if (err) return console.log(err);
      })
}

function updateMeasure(change) {
    for (let i = 0; i < measuresJson.length; i++) {
        if (measuresJson[i].measureId == change.measureId) {
            measuresJson[i] = {
                ...measuresJson[i],
                ...change as any,
            };
        }
    }
}

makeChanges()