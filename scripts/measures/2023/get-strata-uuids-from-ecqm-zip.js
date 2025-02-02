#!/usr/bin/env node

const _ = require('lodash');
const fs = require('fs');
const rimraf = require('rimraf');
const path = require('path');
const Promise = require('bluebird');
const AdmZip = require('adm-zip');
const parseString = require('xml2js').parseString;
const tmpDir = '/tmp/ecqm';
const tmpPath = '/tmp/ecqm/xmls';
const currentYear = '2023';
const zipPath = '../../../staging/' + currentYear + '/EC-eCQM-2022-05-v3.zip';
if (!zipPath) {
  console.log('Missing required argument <path to zip>');
  process.exit(1);
}

/*
return strata name, description, and uuids like so
[
  {
    name: 'strata1',
    description: 'Patients who initiated treatment within 14 days of the diagnosis',
    eMeasureUuids: {
      initialPopulationUuid: '25286925-4221-4396-9DE0-60EA606924DF',
      denominatorUuid: 'CFB8E3E2-FF4F-4D25-B613-7EC142BAE8A9',
      numeratorUuid: 'A399FA9C-48CF-41E5-812A-3445188B8301',
      denominatorExclusionUuid: 'EEAD441F-B3B2-4DC9-A890-B35E14B38EA7',
      denominatorExceptionUuid: 'E76F6606-1DC9-40DE-8A34-5B4B4E859152'
    }
  }
  ...
*/
function extractStrata(measure, emeasureid) {
  // our version of 'strata' are described as 'numerators'
  // parse out strata descriptions from numerator text
  // descriptions are like "Numerator 1: Patients who initiated treatment within 14 days of the diagnosis\nNumerator 2: Patients who initiated treatment and who had two or more additional services with an AOD diagnosis within 30 days of the initiation visit"
  const description = measure.subjectOf
    .find(item => item.measureAttribute[0].code[0].$.code === 'NUMER')
    .measureAttribute[0].value[0].$.value;
  const populationId = ['138', '156'];
  let strataDescriptions;
  if (populationId.includes(emeasureid)) {
    strataDescriptions = _.compact(description.replaceAll(/(\n{0,1}Population \d:\s{0,3}\n)/g, '').split(/\n|\r|&#xA;/));
  } else {
    strataDescriptions = _.compact(description.split(/\n|\r|&#xA;/));
    strataDescriptions = strataDescriptions
      .filter(string => string.match(/^(Numerator \d: )/))
      .map(string => string.substr('Numerator x: '.length).trim());
  }
  if (strataDescriptions.length === 0) {
    // description stores single stratum otherwise
    strataDescriptions = [description.trim()];
  }

  const strata = strataDescriptions.map(description => ({description}));
  // pull out uuids for each stratum
  const components = measure.component.slice(1);
  components.forEach((component, index) => {
    const ids = component.populationCriteriaSection[0].component;
    const eMeasureUuids = {
      initialPopulationUuid: ids.find(item => item.initialPopulationCriteria).initialPopulationCriteria[0].id[0].$.root,
      denominatorUuid: ids.find(item => item.denominatorCriteria).denominatorCriteria[0].id[0].$.root,
      numeratorUuid: ids.find(item => item.numeratorCriteria).numeratorCriteria[0].id[0].$.root
    };

    const denominatorException = ids.find(item => item.denominatorExceptionCriteria);
    if (denominatorException) {
      eMeasureUuids.denominatorExceptionUuid = denominatorException.denominatorExceptionCriteria[0].id[0].$.root;
    }

    const denominatorExclusion = ids.find(item => item.denominatorExclusionCriteria);
    if (denominatorExclusion) {
      eMeasureUuids.denominatorExclusionUuid = denominatorExclusion.denominatorExclusionCriteria[0].id[0].$.root;
    }
    strata[index].eMeasureUuids = eMeasureUuids;
  });

  return strata;
}

// gather list of xml files
rimraf.sync(tmpDir);
new AdmZip(zipPath).extractAllTo(tmpDir, true);
// each measure has its own zip, collect name of SimpleXML files
const xmlFiles = fs.readdirSync(tmpDir)
  .map(measureZip => {
    const folder = (measureZip.toString().split('.')[0].replace('-v2', ''));
    const zip = new AdmZip(path.join(tmpDir, measureZip));
    const { entryName: filename } = zip.getEntries()
      .find(({entryName}) => {
        const filename = entryName.toString();
        return filename.includes('.xml') && filename.includes(folder);
      });

    // extract 'CMS75v5.xml' to /xmls
    zip.extractEntryTo(filename, tmpPath, false, true);
    return filename;
  });

// parse files into JavaScript objects
const promisifiedParseString = Promise.promisify(parseString);
Promise.all(
  xmlFiles.map(xmlFile => {
    return promisifiedParseString(fs.readFileSync(path.join(tmpPath, xmlFile)));
  })
)
// extract data from converted JavaScript objects
  .then(docs => {
    return _.compact(docs.map(doc => {
      const measure = doc.QualityMeasureDocument;
      const emeasureid = measure.subjectOf[0].measureAttribute[0].value[0].$.value;
      // These must all be manually added. No accurate way to parse their uuid's
      const ignoredMeasureIds = ['145', '157', '347'];
      if (ignoredMeasureIds.includes(emeasureid)) {
        console.warn('WARNING: CMS' + emeasureid + ' has one numerator but multiple populations and needs to be added manually');
        return;
      }
      const strata = extractStrata(measure, emeasureid);
      const version = measure.versionNumber[0].$.value.split('.')[0];
      const eMeasureId = `CMS${emeasureid}v${version}`;
      const mType = (strata.length > 1 || emeasureid === '159') ? 'multiPerformanceRate' : 'singlePerformanceRate';
      return {
        eMeasureId,
        eMeasureUuid: measure.id[0].$.root,
        strata: strata,
        metricType: mType
      };
    }));
  })
// sort and write extracted data to disk
  .then(ecqms => {
    const sortedEcqms = _.sortBy(ecqms, ['eMeasureId']);
    fs.writeFileSync(path.join(__dirname, '../../../util/measures/' + currentYear + '/generated-ecqm-data.json'), JSON.stringify(sortedEcqms, null, 2));
    console.warn('remember to add the strata names manually!');
  });
