class TimeEntriesConverter {
    constructor() {

    }

    timeEntriesFromFormValues() {
        return tyme.timeEntries(
            formValue.startDate,
            formValue.endDate,
            formValue.taskIDs,
            null,
            formValue.onlyUnbilled ? 0 : null,
            formValue.includeNonBillable ? null : true,
            formValue.teamMemberID
        ).filter(function (timeEntry) {
            return parseFloat(timeEntry.sum) > 0;
        })
    }

    timeEntryIDs() {
        return this.timeEntriesFromFormValues()
            .map(function (entry) {
                return entry.id;
            });
    }

    aggregatedTimeEntryData() {
        let data =
            this.timeEntriesFromFormValues()
                .reduce(function (data, timeEntry) {
                    const key = timeEntry.task_id + timeEntry.subtask_id;

                    if (data[key] == null) {
                        let entry = {
                            'name': '',
                            'quantity': 0.0,
                            'unit': '',
                            'price': parseFloat(timeEntry.rate),
                            'note': '',
                            'sum': 0.0
                        };

                        // unit: Stk=1, Std=9, km=10

                        if (timeEntry.type === 'timed') {
                            entry.unit = utils.localize('unit.hours')
                        } else if (timeEntry.type === 'mileage') {
                            entry.unit = utils.localize('unit.kilometer')
                        } else if (timeEntry.type === 'fixed') {
                            entry.unit = utils.localize('unit.quantity')
                        }

                        entry.name = timeEntry.task;

                        if (timeEntry.subtask.length > 0) {
                            entry.name += ': ' + timeEntry.subtask
                        }

                        data[key] = entry;
                    }

                    let currentQuantity = 0;

                    if (timeEntry.type === 'timed') {
                        currentQuantity = parseFloat(timeEntry.duration) / 60.0
                        data[key].quantity += currentQuantity;
                    } else if (timeEntry.type === 'mileage') {
                        currentQuantity = parseFloat(timeEntry.distance)
                        data[key].quantity += currentQuantity;
                    } else if (timeEntry.type === 'fixed') {
                        currentQuantity = parseFloat(timeEntry.quantity)
                        data[key].quantity += currentQuantity;
                    }

                    data[key].sum += timeEntry.sum;

                    if (data[key].note.length > 0 && timeEntry.note.length > 0) {
                        data[key].note += '<br/>';
                    }

                    if (formValue.showTimesInNotes
                        && timeEntry.hasOwnProperty("start")
                        && timeEntry.hasOwnProperty("end")
                        && timeEntry.type !== "fixed") {
                        
                        data[key].note += this.formatDate(timeEntry.start, false) + " ";
                        data[key].note += this.formatDate(timeEntry.start, true) + " - ";
                        data[key].note += this.formatDate(timeEntry.end, true) + " (";
                        data[key].note += this.roundNumber(currentQuantity, 1) + " " + data[key].unit + ")";
                        data[key].note += "<br/>";
                    }

                    data[key].note += timeEntry.note;
                    return data;

                }.bind(this), {});

        return Object.keys(data)
            .map(function (key) {
                return data[key];
            })
            .sort(function (a, b) {
                return a.name > b.name;
            });
    }

    formatDate(dateString, timeOnly) {
        let locale = utils.localize('locale.identifier');
        if (timeOnly) {
            return (new Date(dateString)).toLocaleTimeString(locale, {hour: '2-digit', minute: '2-digit'});
        } else {
            return (new Date(dateString)).toLocaleDateString(locale);
        }
    }

    roundNumber(num, places) {
        return (+(Math.round(num + "e+" + places) + "e-" + places)).toFixed(places);
    }

    generatePreview() {
        const data = this.aggregatedTimeEntryData()
        const total = data.reduce(function (sum, timeEntry) {
            sum += timeEntry.sum;
            return sum;
        }, 0.0);

        let str = '';
        str += '![](plugins/BillomatInvoices/billomat_logo.png)\n';
        str += '## ' + utils.localize('invoice.header') + '\n';

        str += '|' + utils.localize('invoice.position');
        str += '|' + utils.localize('invoice.price');
        str += '|' + utils.localize('invoice.quantity');
        str += '|' + utils.localize('invoice.unit');
        str += '|' + utils.localize('invoice.net');
        str += '|\n';

        str += '|-|-:|-:|-|-:|\n';

        data.forEach((entry) => {

            var name = entry.name;

            if (formValue.showNotes) {
                name = '**' + entry.name + '**';
                name += '<br/>' + entry.note.replace(/\n/g, '<br/>');
            }

            str += '|' + name;
            str += '|' + entry.price.toFixed(2) + ' ' + tyme.currencySymbol();
            str += '|' + entry.quantity.toFixed(2);
            str += '|' + entry.unit;
            str += '|' + entry.sum.toFixed(2) + ' ' + tyme.currencySymbol();
            str += '|\n';
        });

        str += '|||||**' + total.toFixed(2) + ' ' + tyme.currencySymbol() + '**|\n';
        return utils.markdownToHTML(str);
    }
}

class BillomatResolver {
    constructor(billomatID, apiKey, timeEntriesConverter) {
        this.apiKey = apiKey;
        this.billomatID = billomatID.length !== 0 ? billomatID : "default";
        this.headers = {'X-BillomatApiKey': this.apiKey};
        this.baseURL = 'https://' + this.billomatID + '.billomat.net/api/';
        this.timeEntriesConverter = timeEntriesConverter;
    }

    getClientContacts() {
        this.clients = [];

        const totalPages = this.getClientPage(1);
        for (let i = 2; i <= totalPages; i++) {
            this.getClientPage(i);
        }

        if (this.clients.length === 0) {
            this.clients.push({
                'name': utils.localize('input.data.empty'),
                'value': ''
            });
        }

        return this.clients;
    }

    getClientPage(page) {
        const url = this.baseURL + 'clients';
        const response = utils.request(url, 'GET', this.headers, {'per_page': 50, 'page': page});
        const statusCode = response['statusCode'];
        const result = response['result'];

        if (statusCode === 200) {
            const parsedData = JSON.parse(result);

            if (!parsedData['clients']["client"]) {
                return 0;
            }

            const clients = parsedData['clients']["client"];
            const total = parsedData['clients']['@total'];

            for (let client of clients) {
                const contacts = this.getContacts(client['id']);

                for (let contact of contacts) {
                    this.clients.push({
                        'name': client['name'] + " - " + contact['first_name'] + " " + contact['last_name'],
                        'value': client['id'] + "#" + contact['id']
                    });
                }
            }

            return total;
        } else {
            return 0;
        }
    }

    getContacts(clientID) {
        const url = this.baseURL + 'contacts';
        // we are optimistic and assume, that the user does not have more than 100 contacts per client.
        const response = utils.request(url, 'GET', this.headers, {'client_id': clientID, 'per_page': 100, 'page': 1});
        const statusCode = response['statusCode'];
        const result = response['result'];

        if (statusCode === 200) {
            const parsedData = JSON.parse(result);
            if (!parsedData['contacts']["contact"]) {
                return [];
            }

            return parsedData['contacts']["contact"];
        } else {
            return [];
        }
    }

    createNewInvoice() {
        const invoiceID = this.makeCreateInvoiceCall();

        if (invoiceID !== null) {
            if (formValue.markAsBilled) {
                const timeEntryIDs = this.timeEntriesConverter.timeEntryIDs();
                tyme.setBillingState(timeEntryIDs, 1);
            }

            tyme.openURL('https://' + this.billomatID + '.billomat.net/app/invoices/show/entityId/' + invoiceID);
        }
    }

    makeCreateInvoiceCall() {
        const splittedIDs = formValue.clientContact.split('#');
        if (splittedIDs.length !== 2) {
            tyme.showAlert('Billomat', utils.localize('input.data.empty'));
            return null;
        }

        const clientID = splittedIDs[0];
        const contactID = splittedIDs[1];

        const data = this.timeEntriesConverter.aggregatedTimeEntryData()
        let invoiceItems = [];

        data.forEach((entry) => {
            const note = formValue.showNotes ? entry.note.replaceAll('<br/>', '\n') : '';

            invoiceItems.push({
                "invoice-item": {
                    "unit": entry.unit,
                    "unit_price": entry.price.toFixed(2),
                    "quantity": entry.quantity.toFixed(2),
                    "title": entry.name,
                    "description": note
                }
            })
        });

        let params = {
            "invoice": {
                "client_id": clientID,
                "contact_id": contactID,
                "supply_date_type": "SUPPLY_TEXT",
                "supply_date": formValue.startDate.toDateString() + " - " + formValue.endDate.toDateString(),
                "net_gross": "NET",
                "invoice-items": invoiceItems
            }
        };

        const url = this.baseURL + 'invoices';
        const response = utils.request(url, 'POST', this.headers, params);
        const statusCode = response['statusCode'];
        const result = response['result'];

        if (statusCode === 201) {
            const parsedData = JSON.parse(result);
            return parsedData["invoice"]["id"];
        } else {
            tyme.showAlert('Billomat API Error', JSON.stringify(response));
            return null;
        }
    }
}

const timeEntriesConverter = new TimeEntriesConverter();
const billomatResolver = new BillomatResolver(formValue.billomatID, formValue.apiKey, timeEntriesConverter);