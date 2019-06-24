import xl from 'xlsx'
import csv from 'fast-csv'
import fs from 'fs'
import { delimiter } from 'path';
import ipcMain from 'electron';
import moment from 'moment';
import iconv from 'iconv-lite'
export default class Analyzer {
    constructor() {
        this.orderWS;
        this.staticDataAll = [];
        this.staticData = [];
        this.ordersFilepath = '';
        this.dataFilepath = '';
        this.showDataCard = false;
        this.showOrdersCard = false;
        this.allOrdersData = [];
        this.allOrdersCount;
        this.closedOrders = [];
        this.closedOrdersCount;
        this.uniqueATMFromOrders;
        this.arrUniqueATM = [];
        this.ordersStartTime = moment();
        this.ordersEndTime = moment('1995-12-25');
        this.atmCoverage = 'Недостатньо даних';
        this.missingATMs = '';
        this.freeDates = [],
            this.workingSaturdays = [];
    }
    getStateForHome() {
        return {
            showDataCard: this.showDataCard,
            showOrdersCard: this.showOrdersCard,
            dataCardName: 'Статичні дані',
            ordersCardName: 'Дані заявок',
            dataCardPath: this.dataFilepath,
            ordersCardPath: this.ordersFilepath,
            allOrdersCount: this.allOrdersCount,
            closedOrdersCount: this.closedOrdersCount,
            uniqueATMFromOrders: this.uniqueATMFromOrders,
            ordersStartTime: `${this.ordersStartTime.format('DD.MM.YYYY HH:mm:ss')}`,
            ordersEndTime: `${this.ordersEndTime.format('DD.MM.YYYY HH:mm:ss')}`,
            staticDataATMCount: this.staticData.length,
            staticDataAllATMCount: this.staticDataAll.length,
            atmCoverage: this.atmCoverage,
            missingATMs: this.missingATMs
        }
    }
    loadOrdersData(filepath, win) {
        if (!filepath) return;
        filepath = filepath[0];
        this.ordersFilepath = filepath;
        this.showOrdersCard = true;
        /*
        const customHeaders = [
            'orderId',//'Id заявки',
            'atmId', //'Id банкомата',
            'atmSn',  //'SN банкомата',
            'type', //'Тип',
            'model', //'Модель',
            'adress',//'Адреса',
            'city', //'Місто',
            'region',//'Область',
            'placedAt', //'Розташування'
            'localization',//'Локалізація',
            'orderDetails',//'Опис заявки',
            'orderReport',  //'Звіт',
            'orderState',//'Стан заявки',
            'createdTime',//'Час створення',
            'accessTime',  //'Час доступа',
            'plannedTime', //'Плановий час',
            'realTime' //'Фактичний час',
        ]
        */
        let str = iconv.decode(fs.readFileSync(filepath), 'win1251');
        String.prototype.splice = function(idx, rem, str) {
            return this.slice(0, idx) + str + this.slice(idx + Math.abs(rem));
        };
        str = str.splice(str.indexOf('\n') - 1, 0, "Плановий час МЦ|");
        console.log();
        const parseOptions = {
            delimiter: "|",
            headers: true,
            objectMode: true,
            quote:'\\'
        }
        this.allOrdersData = [];
        this.closedOrdersCount = 0;
        this.allOrdersCount = 0;
        csv
            .fromString(str, parseOptions)
            .on('error', error => {
                this.ordersFilepath = 'Помилка при зчитуванні ' + filepath;
                win.send('data:upload', this.getStateForHome());
            })
            .on('data', (orderObj) => {
                this.allOrdersData.push(orderObj);
            })
            .on('end', (rows) => {
                //console.log(`parsed ${rows} rows`);
                this.analyzeAllOrders();
                this.findATMCoverage();
                win.send('orders:upload', this.getStateForHome());
            });
        //orders
    }
    loadStaticData(filepath, win) {
        if (!filepath) return;
        filepath = filepath[0];
        this.dataFilepath = filepath;
        this.showDataCard = true;
        
        const parseOptions = {
            delimiter: "|",
            headers: true,
            objectMode: true
        }

        const str = iconv.decode(fs.readFileSync(filepath), 'win1251');
        
        this.staticDataAll = [];
        this.staticData = [];
        let rowsCount = 0;
        csv
            .fromString(str, parseOptions)
            .on('error', error => {
                console.error(rowsCount, error);
                this.dataFilepath = 'Помилка при зчитуванні ' + this.dataFilepath;
                win.send('data:upload', this.getStateForHome());
            })
            .on('data', (dataObj) => {
                this.staticDataAll.push(dataObj);
                if (dataObj['виробник'] == "NCR") {
                    this.staticData.push(dataObj);
                }
            })
            .on('end', (rows) => {
                //console.log(`static parsed, all:${this.staticDataAll.length}, ncr:${this.staticData.length}`);
                //checking if orders file has been parsed
                this.findATMCoverage();
                win.send('data:upload', this.getStateForHome());
            });
        //static
    }

    analyzeAllOrders() {
        if (!this.allOrdersData) return console.warn('No orders to analyze.');
        this.allOrdersCount = this.allOrdersData.length;
        this.closedOrders = [];
        this.allOrdersData.forEach((order) => {
            if (order['Стан заявки'] == "Заявка закрита") {
                this.closedOrders.push(order);
                //console.log(`asc:${order['Час доступа']} pln:${order['Плановий час']} real:${order['Фактичний час']}`) 
            }
        })
        this.closedOrdersCount = this.closedOrders.length;
        this.findUnique();
        this.findStartEndTime();
        //console.log(`analyzed orders, overall: ${this.allOrdersCount} closed: ${this.closedOrdersCount}`)
    }

    findUnique() {
        this.arrUniqueATM = [];
        for (let i = 0; i < this.closedOrders.length; i++) {
            if (!this.arrUniqueATM.some(e => e['Id банкомата'] == this.closedOrders[i]['Id банкомата']))
                this.arrUniqueATM.push(this.closedOrders[i]);
        }
        this.uniqueATMFromOrders = this.arrUniqueATM.length;
    }

    findStartEndTime() {
        this.ordersStartTime = moment();
        this.ordersEndTime = moment('1995-12-25');
        const format = 'DD.MM.YYYY hh:mm:ss'
        this.closedOrders.forEach((el) => {
            el.creationTime = moment(el['Час створення'], format);
            el.realTime = moment(el['Фактичний час'], format);

            //console.log(`[${el['Час створення']}][${el['Фактичний час']}]`);

            if (el.creationTime < this.ordersStartTime) {
                this.ordersStartTime = el.creationTime;
            }
            if (el.realTime > this.ordersEndTime) {
                this.ordersEndTime = el.realTime
            }
        });
    }

    findATMCoverage() {
        this.missingATMs = '';
        this.atmCoverage = 'Недостатньо даних';
        if (!this.closedOrdersCount || !this.staticDataAll.length || !this.arrUniqueATM.length) {
            return;
        }
        let found = 0;
        let notFoundInStatic = []
        this.arrUniqueATM.forEach((el) => {
            if (this.staticDataAll.some(e => e['ID'] == el['Id банкомата'])) {
                found++;
            } else {
                notFoundInStatic.push(el);
            }
        })
        this.closedOrders.forEach((order) => {
            order.staticData = this.staticDataAll.find((row) => { return row['ID'] == order['Id банкомата'] });
            if (!order.staticData) {
                //console.log(`not found atmid:${order['Id банкомата']} orderid:${order['Id заявки']}`)
            }
            //console.log(order.staticData);
        })

        this.atmCoverage = `${found}/${this.uniqueATMFromOrders}`;
        //console.log(this.atmCoverage);

        notFoundInStatic.forEach((el) => {
            this.missingATMs += `${el['Id банкомата']}, `;
        })
        if (!notFoundInStatic.length) {
            this.missingATMs = 'Статичні дані присутні для всіх АТМ';
        } else {
            this.missingATMs = this.missingATMs.slice(0, -2);
        }
    }

    createReport(freeDates, workingSaturdays) {
        this.freeDates = freeDates;
        this.workingSaturdays = workingSaturdays;
        let regExpDays = /FLM-(\d);SLM-(\d)/;
        let regExpHours = /\w+ (\d+)/;
        let timeFormat = 'DD.MM.YYYY HH:mm:ss';
        let timeFormatDisplay = 'DD.MM.YYYY HH:mm';
        let dateFormat = 'DD.MM HH:mm';
        this.arrForXLS = [];
        //fixing static data to each order
        this.closedOrders.forEach((order) => {

            order.staticData = this.staticDataAll.find(e => e['ID'] == order['Id банкомата']); //if not found returns undefined 
            if (!order.staticData || order.staticData['ID'] == "4158") return;  //4158 - test ATM

            let resDays = regExpDays.exec(order.staticData['особливості']);
            let resHoursFLM = regExpHours.exec(order.staticData['flm']);
            let resHoursSLM = regExpHours.exec(order.staticData['slm']);

            order.workingDaysFLM = parseInt(resDays[1]);
            order.workingDaysSLM = parseInt(resDays[2]);
            order.hoursFLM = parseInt(resHoursFLM[1]);
            order.hoursSLM = parseInt(resHoursSLM[1]);

            order.timeCreated = moment(order['Час створення'], timeFormat);
            order.timeAccess = moment(order['Час доступа'], timeFormat);
            order.timePlanned = moment(order['Плановий час'], timeFormat);
            order.timeReal = moment(order['Фактичний час'], timeFormat);

            order.timeToComplete = this.countTimeToComplete(order);
            order.diffCreateAccess = this.countDiffCreateAccess(order);
            order.diffAccessPlanned = this.countDiffAccessPlanned(order);
            order.diffPlannedReal = this.countDiffPlannedReal(order);
            let symbolToAddBefore = this.timelineDirection ? '+' : '-';

            let timeToCompleteStr = this.formStr(order.timeToComplete);
            let diffCreateAccessStr = this.formStr(order.diffCreateAccess);
            let diffAccessPlannedStr = this.formStr(order.diffAccessPlanned);
            let diffPlannedRealStr = `${symbolToAddBefore}${this.formStr(order.diffPlannedReal)}`;
            //console.log(`order: ${order['Id заявки']} atm: ${order.staticData['ID']} type: ${order['Тип'].substring(0, 3)} | flm: ${order.workingDaysFLM} slm: ${order.workingDaysSLM} | acs: ${order.timeAccess.format(timeFormatDisplay)} | fact: ${order.timeReal.format(timeFormatDisplay)} | complete: ${hoursStr}`);

            let deadlineCorrect;
            let isInTime;
            
            if (order['Тип'] == 'flm') {
                if (order.diffAccessPlanned.hours() < order.hoursFLM || (order.diffAccessPlanned.hours() == order.hoursFLM && order.diffAccessPlanned.minutes() <= 5)) {
                    deadlineCorrect = 'Коректно';
                } else {
                    deadlineCorrect = 'Некоректно';
                }
                if (((order.timeToComplete.days() * 24) + order.timeToComplete.hours()) < order.hoursFLM || (order.timeToComplete.hours() == order.hoursFLM && order.timeToComplete.minutes() <= 5)) {
                    
                    isInTime = 'Вчасно';
                } else {
                    isInTime = 'Прострочено';
                }
            } else {
                if (order.diffAccessPlanned.hours() < order.hoursSLM || (order.diffAccessPlanned.minutes() <= 5 && order.diffAccessPlanned.hours() == order.hoursSLM)) {
                    deadlineCorrect = 'Коректно';
                } else {
                    deadlineCorrect = 'Некоректно';
                }

                if (((order.timeToComplete.days() * 24) + order.timeToComplete.hours()) < order.hoursSLM || (order.timeToComplete.hours() == order.hoursSLM && order.timeToComplete.minutes() <= 5)) {
                    isInTime = 'Вчасно';
                } else {
                    isInTime = 'Прострочено';
                }
            }
            
            this.arrForXLS.push({
                'Id заявки': order['Id заявки'],
                'Id банкомата': order.staticData['ID'],
                'SN банкомата': order.staticData['серійний номер'],
                'Тип': order['Тип'],
                'Локалізація': order['Локалізація'],
                'Опис заявки': order['Опис заявки'],
                'Звіт': order['Звіт'],
                'Час створення': order['Час створення'],
                'Час доступа': order['Час доступа'],
                'Різниця між часом створення та часом доступу (робочих годин)': diffCreateAccessStr,
                'Плановий час': order['Плановий час'],
                'Різниця між плановим часом та часом доступу (робочих годин) Фактично встановлення строків FLM\\SLM': diffAccessPlannedStr,
                'Коректність встановлення дедлайнів': deadlineCorrect,
                'Різниця між фактичним часом та плановим (робочих годин)': diffPlannedRealStr,
                'Фактичний час': order['Фактичний час'],
                'Різниця між фактичним часом та часом доступу (робочих годин)': timeToCompleteStr,
                'Порівняння різниці фактичного часу та часу доступу з FLM\\SLM': isInTime,	
                'FLM, годин на виконання': order.hoursFLM,
                'SLM, годин на виконання': order.hoursSLM,
                'Режим обслуговування': order.staticData['особливості']
            });
        });
    }

    countTimeToComplete(order) {
        let timePassed = moment.duration(0, 's')
        order.cursor = moment(order.timeAccess);

        while (order.cursor.isBefore(order.timeReal)) {
            if (this.isWorkTime(order)) {
                timePassed.add(1, 'm');
            }
            order.cursor.add(moment.duration(1, 'm'))
        }
        return timePassed;
    }

    countDiffCreateAccess(order) {
        let timePassed = moment.duration(0, 's')
        order.cursor = moment(order.timeCreated);
        while (order.cursor.isBefore(order.timeAccess)) {
            if (this.isWorkTime(order)) {
                timePassed.add(1, 'm');
            }
            order.cursor.add(moment.duration(1, 'm'))
        }
        return timePassed;
    }

    countDiffAccessPlanned(order) {
        let timePassed = moment.duration(0, 's')
        order.cursor = moment(order.timeAccess);
        while (order.cursor.isBefore(order.timePlanned)) {
            if (this.isWorkTime(order)) {
                timePassed.add(1, 'm');
            }
            order.cursor.add(moment.duration(1, 'm'))
        }
        return timePassed;
    }

    countDiffPlannedReal(order) {
        let timelineDirection = order.timePlanned.isBefore(order.timeReal);
        this.timelineDirection = timelineDirection;
        let timePassed = moment.duration(0, 's')
        if (timelineDirection) {
            order.cursor = moment(order.timePlanned);
            while (order.cursor.isBefore(order.timeReal)) {
                if (this.isWorkTime(order)) {
                    timePassed.add(1, 'm');
                }
                order.cursor.add(moment.duration(1, 'm'))
            }
        } else {
            order.cursor = moment(order.timeReal);
            while (order.cursor.isBefore(order.timePlanned)) {
                if (this.isWorkTime(order)) {
                    timePassed.add(1, 'm');
                }
                order.cursor.add(moment.duration(1, 'm'))
            }
        }
        return timePassed;
    }

    isWorkTime(order) {
        //check if it is in time limit between 9:00 and 18:00
        if (parseInt(order.cursor.hour()) < 9 || parseInt(order.cursor.hour()) > 17) {
            return false
        }
        //check if it is free day from selected days in calendar
        let isFreeday = this.freeDates.some((day) => {
            return (order.cursor.date() == day.date() && order.cursor.month() == day.month())
        });
        //check if it is working saturday
        let isWorkingSaturday = this.workingSaturdays.some((day) => {
            return (order.cursor.date() == day.date() && order.cursor.month() == day.month())
        });

        //If it is free day and flm service time is less than 6 
        if (isFreeday && order['Тип'] == 'flm' && order.workingDaysFLM <= 5) {
            return false;
        }
        if (isFreeday && order['Тип'] == 'atm repair') {
            return false;
        }
        //check if it is service weekday for ATM from order
        let weekday = order.cursor.weekday();
        if (weekday == 0) weekday = 7;

        if (order['Тип'] == 'flm') {
            if (weekday > order.workingDaysFLM && !isWorkingSaturday) {
                return false
            }
        } else {
            if (weekday > order.workingDaysSLM) {
                return false
            }
        }

        //otherwise it's working time
        //console.log(order.cursor.format('DD.MM HH:mm'))
        return true
    }

    formStr(moment) {
        return `${String((moment.days() * 24) + moment.hours()).padStart(2, '0')}:${String(moment.minutes()).padStart(2, 0)}`;
    }

}
