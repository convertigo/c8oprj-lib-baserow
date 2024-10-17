


# lib_BaseRow

This is the Baserow connector for Convertigo. Use this connector to exchange data with Baserow databases.

## Symbols
This library uses the following symbols

| Symbol    | Usage |
|-----------|-------------------|
|lib_baserow.server  | the host name of the baserow server |
|lib_baserow.port    | the port baserow server, set to 443 for https, to 80 for http |
|lib_baserow.https   | set to true for https, to false otherwise |
|lib_baserow.password.secret| The baserow admin password |
|lib_baserow.adminuser| The baserow admin user email. |

For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Sequences](#sequences)
    - [AdminLogin](#adminlogin)
    - [AdminUserCreate](#adminusercreate)
    - [AdminUserDelete](#adminuserdelete)
    - [AssetFileUpload](#assetfileupload)
    - [ClearTableIdCache](#cleartableidcache)
    - [DatabaseTokenCreate](#databasetokencreate)
    - [DatabaseTokenDelete](#databasetokendelete)
    - [DatabaseTokenList](#databasetokenlist)
    - [FieldsList](#fieldslist)
    - [FieldsListApiKey](#fieldslistapikey)
    - [forms_AddRow](#forms_addrow)
    - [forms_ApplicationsList](#forms_applicationslist)
    - [forms_DeleteRow](#forms_deleterow)
    - [formssource_CheckConfig](#formssource_checkconfig)
    - [formssource_GetFieldValues](#formssource_getfieldvalues)
    - [formssource_GetSelectData](#formssource_getselectdata)
    - [formssource_GetTableData](#formssource_gettabledata)
    - [FSExecuteView](#fsexecuteview)
    - [FSPullAndPushTable](#fspullandpushtable)
    - [GroupsList](#groupslist)
    - [TableBulkExportToCSV](#tablebulkexporttocsv)
    - [TableBulkExportWaitFInished](#tablebulkexportwaitfinished)
    - [TableBulkImportFromCSV](#tablebulkimportfromcsv)
    - [TableBulkUpdateFromCSV](#tablebulkupdatefromcsv)
    - [TableCreateRow](#tablecreaterow)
    - [TableCreateRowApiKey](#tablecreaterowapikey)
    - [TableCreateRows](#tablecreaterows)
    - [TableCreateRowsApiKey](#tablecreaterowsapikey)
    - [TableCreateView](#tablecreateview)
    - [TableCreateViewFilter](#tablecreateviewfilter)
    - [TableDeleteAllRows](#tabledeleteallrows)
    - [TableDeleteRow](#tabledeleterow)
    - [TableDeleteView](#tabledeleteview)
    - [TableGetData](#tablegetdata)
    - [TableGetDataApiKey](#tablegetdataapikey)
    - [TableGetRowByIdApiKey](#tablegetrowbyidapikey)
    - [TableGetViews](#tablegetviews)
    - [TableReadRow](#tablereadrow)
    - [TableUpdateRow](#tableupdaterow)
    - [TableUpdateRowApiKey](#tableupdaterowapikey)
    - [TokenGetOrRefresh](#tokengetorrefresh)
- [Mobile Library](#mobile-library)
    - [Shared Actions](#shared-actions)
        - [DisplayTableColumns](#displaytablecolumns)
    - [Shared Components](#shared-components)
        - [BaseRowGrid](#baserowgrid)


## Installation

1. In your Convertigo Studio use `File->Import->Convertigo->Convertigo Project` and hit the `Next` button
2. In the dialog `Project remote URL` field, paste the text below:
   <table>
     <tr><td>Usage</td><td>Click the copy button</td></tr>
     <tr><td>To contribute</td><td>

     ```
     lib_BaseRow=git@github.com:convertigo/c8oprj-lib-baserow.git:branch=8.4.x
     ```
     </td></tr>
     <tr><td>To simply use</td><td>

     ```
     lib_BaseRow=git@github.com:convertigo/c8oprj-lib-baserow/archive/8.4.x.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __lib_BaseRow__ project


## Sequences

### AdminLogin

Establishes a session with Baserow. Must be called before any other API

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>email</td><td>The Base row admin email</td>
</tr>
<tr>
<td>password</td><td>The baserow admin password</td>
</tr>
</table>

### AdminUserCreate

Create a user

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>email</td><td></td>
</tr>
<tr>
<td>name</td><td></td>
</tr>
<tr>
<td>password</td><td></td>
</tr>
</table>

### AdminUserDelete

Delete a User

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>user_id</td><td>The id of the user to delete</td>
</tr>
</table>

### AssetFileUpload

Uploads a file asset, the returned link can be used to be set as a value of a 'file' Type cell

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td>The API Key</td>
</tr>
<tr>
<td>file</td><td>A File variable holding the path to the file to be uploaded</td>
</tr>
</table>

### ClearTableIdCache

### DatabaseTokenCreate

Create a Token to acess databases within a group. This token will hold permissions to specific databases in the group

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>group_id</td><td>The ID of the group holding the databases to get a token to (Unique)</td>
</tr>
<tr>
<td>name</td><td>Token Name</td>
</tr>
</table>

### DatabaseTokenDelete

Delete a previously created Token by providing its id

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>token_id</td><td>Deletes the token related to the provided value.</td>
</tr>
</table>

### DatabaseTokenList

Create a Token to acess databases within a group. This token will hold permissions to specific databases in the group

### FieldsList

Lists all the fields in a baserow table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>table_id</td><td>Returns only the fields of the table related to the provided value.</td>
</tr>
</table>

### FieldsListApiKey

Lists all the fields in a baserow table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>table_id</td><td>Returns only the fields of the table related to the provided value.</td>
</tr>
</table>

### forms_AddRow

Add or update a row to a Baserow table. Each column of the table must have the same name as the technicalID of a field on the form. Forms fields can be any type, but usually select lists are mapped on Baserow Linked Columns.

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>doc</td><td></td>
</tr>
<tr>
<td>forms_config</td><td>Creates a row in a table with a given configuration</td>
</tr>
<tr>
<td>forms_id</td><td>The ID of the row to update. If not set , the action will add a row. If set, all rows's columns identified by the 'technicalID' will be updated</td>
</tr>
<tr>
<td>originalDoc</td><td></td>
</tr>
</table>

### forms_ApplicationsList

Lists all applications (databases) in baserow

### forms_DeleteRow

Deletes a data row from  a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>doc</td><td></td>
</tr>
<tr>
<td>forms_config</td><td>Creates a row in a table with a given configuration</td>
</tr>
<tr>
<td>forms_id</td><td>The ID of the row to delete</td>
</tr>
<tr>
<td>originalDoc</td><td></td>
</tr>
</table>

### formssource_CheckConfig

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Fills the select component from data with a given configuration. The first column will be the displayed item in the select, the second column will be the value of this item</td>
</tr>
</table>

### formssource_GetFieldValues

Get all possible values for a given field to feed a Select

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Fills the select component from data with a given configuration. The first column will be the displayed item in the select, the second column will be the value of this item</td>
</tr>
</table>

### formssource_GetSelectData

Get data from a Baserow table as options for a Select component. You will be able to choose the Baserow columns for the names to be displayed in the select dropdown list and the column for the values of each name.

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Fills the select component from data with a given configuration. The first column will be the displayed item in the select, the second column will be the value of this item</td>
</tr>
<tr>
<td>forms_filter</td><td>Filters
</td>
</tr>
<tr>
<td>forms_Filter</td><td>A custom filter following  JSON styntax
</td>
</tr>
<tr>
<td>model</td><td>If true, just return one line of data so that No Code studio can compte the table model</td>
</tr>
</table>

### formssource_GetTableData

Get data from a Baserow table for a data grid. Each column of the Baserow table will be displayed as the same column in the data grid

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Returns the rows of the table with a given configuration</td>
</tr>
<tr>
<td>forms_tableFilter</td><td>Filters
</td>
</tr>
<tr>
<td>model</td><td>If true, just return one line of data so that No Code studio can compte the table model</td>
</tr>
</table>

### FSExecuteView

Execute a FullSync View

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>_use_ddoc</td><td></td>
</tr>
<tr>
<td>_use_descending</td><td></td>
</tr>
<tr>
<td>_use_endkey</td><td></td>
</tr>
<tr>
<td>_use_group</td><td></td>
</tr>
<tr>
<td>_use_group_level</td><td></td>
</tr>
<tr>
<td>_use_key</td><td></td>
</tr>
<tr>
<td>_use_limit</td><td></td>
</tr>
<tr>
<td>_use_reduce</td><td></td>
</tr>
<tr>
<td>_use_startkey</td><td></td>
</tr>
<tr>
<td>_use_view</td><td></td>
</tr>
</table>

### FSPullAndPushTable

Push a BaserowTable to FullSync for offline access

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td></td>
</tr>
<tr>
<td>table_id</td><td>The table id to create and start an export job for</td>
</tr>
</table>

### GroupsList

Lists all Groups for the current user

### TableBulkExportToCSV

Exports a Table to CSV.. Export status must me monitored with the TableBulkExportWaitFinished sequence

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>table_id</td><td>The table id to create and start an export job for</td>
</tr>
</table>

### TableBulkExportWaitFInished

Wait for an export job to be finished. Will return the URL to the exported data

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>job_id</td><td>The job id to lookup information about.</td>
</tr>
</table>

### TableBulkImportFromCSV

Uploads a CSV to a table. Each CSV column will be mapped to the existing table Column. If there is more columns in the CSV than in the table additional columns will not be mapped.



**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td>The Number of lines imported for each loop</td>
</tr>
<tr>
<td>files</td><td>List of CSV files to be imported in the table . Can be only one</td>
</tr>
<tr>
<td>fileSeparator</td><td>The column seperatorr ( , or ; )</td>
</tr>
<tr>
<td>firstLineColumn</td><td>Set to true if the first CSV lines represents columns names</td>
</tr>
<tr>
<td>quoteChar</td><td>The character to be used to identify strings ion the CSV file (Usually " but can be ')</td>
</tr>
<tr>
<td>table_id</td><td>The table ID (Can also be a generic 'Workspace~>Base~>Table' definition)</td>
</tr>
</table>

### TableBulkUpdateFromCSV

Updates or inserts data in a Table from a CSV file. Given a list of column names, the sequence will update all lines from the CSV where the column names will be considered as unique ids. If CSV file contains lines not matching the columns names, they will be added to the table.


**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td>The Number of lines imported for each loop</td>
</tr>
<tr>
<td>files</td><td>List of CSV files to be imported in the table . Can be only one</td>
</tr>
<tr>
<td>fileSeparator</td><td>The column seperatorr ( , or ; )</td>
</tr>
<tr>
<td>firstLineColumn</td><td>Set to true if the first CSV lines represents columns names</td>
</tr>
<tr>
<td>quoteChar</td><td>The character to be used to identify strings ion the CSV file (Usually " but can be ')</td>
</tr>
<tr>
<td>table_id</td><td>The table ID (Can also be a generic 'Workspace~>Base~>Table' definition)</td>
</tr>
<tr>
<td>uniqueFields</td><td>List of fields name  representing an unique line in the CSV identifying the line to be updated in the table. (Can be only one field)</td>
</tr>
</table>

### TableCreateRow

Creates a row  in a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>before</td><td>If provided then the newly created row will be positioned before the row with the provided id.</td>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableCreateRowApiKey

Creates a row  in a table using an apikey instead of credentials

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>before</td><td>If provided then the newly created row will be positioned before the row with the provided id.</td>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableCreateRows

Creates a row  in a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableCreateRowsApiKey

Creates a row  in a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>data</td><td>A JSON object with each field name and value, such as: {"items" : [{"field1":"value1", "field2": "value2"}, {"field1":"value1B", "field2": "value2B"}]}</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
<tr>
<td>user_field_names</td><td>A flag query parameter which if provided this endpoint will expect and return the user specified field names instead of internal Baserow field names (field_123 etc).</td>
</tr>
</table>

### TableCreateView

Creates a new view for the table related

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>data</td><td></td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableCreateViewFilter

Updates the existing filter if the authorized user has access to the related database's group.

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>data</td><td></td>
</tr>
<tr>
<td>table_id</td><td>Returns only the fields of the table related to the provided value.</td>
</tr>
<tr>
<td>view_id</td><td>Creates a filter for the view related to the provided value.</td>
</tr>
</table>

### TableDeleteAllRows

Deletes all rows from a table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>chunkSize</td><td>The Number of lines deleted for each loop</td>
</tr>
<tr>
<td>table_id</td><td>The table ID (Can also be a generic 'Workspace~>Base~>Table' definition)</td>
</tr>
</table>

### TableDeleteRow

deletes a row from a  from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>row_id</td><td>Deletes the row related to the value.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
</table>

### TableDeleteView

Deletes the existing view if the authorized user has access to the related database's group. Note that all the related settings of the view are going to be deleted also. The data stays intact after deleting the view because this is related to the table and not the view.

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>view_id</td><td>Deletes the view related to the provided value.</td>
</tr>
</table>

### TableGetData

Gets data from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>describeStructure</td><td></td>
</tr>
<tr>
<td>exclude</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the exclude query parameter. If you for example provide the following GET parameter `exclude=field_1,field_2` then the fields with id `1` and id `2` are going to be excluded from the selection and response. If the `user_field_names` parameter is provided then instead exclude should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `exclude=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `exclude=My Field,Field with \"`.</td>
</tr>
<tr>
<td>filterExpression</td><td>A JSON Structure representing the filters in the form :

```
{
	"mode": "AND",  // Can be AND or OR
	"filters": [
		{
			"field": "Name",  	// The name of the column to filter on
			"op": "contains",	// the operation, can be any of the operations described below
			"value": "Little"	// The value of the filter operation
		},
		{
			"field": "Description",
			"op": "contains",
			"value": "1954"
		}
	]
}
```

### operations

|Filter	|Example value	| Full example |
|-------|---------------|--------------|
|equal	|string	|field is 'string'|
|not_equal	|string	|field is not 'string'|
|date_equal	|2020-01-01	|field is date '2020-01-01'|
|date_not_equal	|2020-01-01	|field is not date '2020-01-01'|
|date_equals_today	|	|field is today|
|date_before_today	|	|field is before today|
|date_after_today	|	|field is after today|
|date_equals_days_ago	|Europe/Paris?1	|field is days ago 'Europe/Paris?1'|
|date_equals_months_ago	|Europe/Paris?1	|field is months ago 'Europe/Paris?1'|
|date_equals_years_ago	|Europe/Paris?1	|field is years ago 'Europe/Paris?1'|
|date_equals_week	|	|field in this week|
|date_equals_month	|	|field in this month|
|date_equals_year	|	|field in this year|
|date_equals_day_of_month|	1	|field day of month is '1'|
|date_before	|2020-01-01	|field is before date '2020-01-01'|
|date_after	|2020-01-01	|field is after date '2020-01-01'|
|contains	|string	|field contains 'string'|
|filename_contains|	string|	field filename contains 'string'|
|has_file_type|	image / document	|field has file type 'image / document'|
|contains_not 	string	|field contains not 'string'|
|length_is_lower_than	|5	|field length is lower than '5'|
|higher_than	|100|	field higher than '100'|
|lower_than	|100|	field lower than '100'|
|single_select_equal|	1	|field is '1'|
|single_select_not_equal|	1	|field is not '1'|
|boolean|	true|	field is 'true'|
|link_row_has|	1|	field has '1'|
|link_row_has_not|	1	|field has not '1'|
|link_row_contains|	string	|field contains 'string'|
|link_row_not_contains|	string|	field contains not 'string'|
|multiple_select_has|	1|	field has '1'|
|multiple_select_has_not|	1|	field has not '1'|
|empty|		|field is empty|
|not_empty|		|field is not empty|
</td>
</tr>
<tr>
<td>include_fields</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the include query parameter. If you for example provide the following GET parameter `include=field_1,field_2` then only the fields withid `1` and id `2` are going to be selected and included in the response. If the `user_field_names` parameter is provided then instead include should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `include=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `include=My Field,Field with \"`.</td>
</tr>
<tr>
<td>order_by</td><td>Optionally the rows can be ordered by provided field ids separated by comma. By default a field is ordered in ascending (A-Z) order, but by prepending the field with a '-' it can be ordered descending (Z-A). If the `user_field_names` parameter is provided then instead order_by should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `order_by=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `order_by=My Field,Field with \"`.</td>
</tr>
<tr>
<td>page</td><td>Defines which page of rows should be returned.</td>
</tr>
<tr>
<td>search</td><td>If provided only rows with data that matches the search query are going to be returned.</td>
</tr>
<tr>
<td>size</td><td>Defines how many rows should be returned per page.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
<tr>
<td>view_id</td><td>Includes all the filters and sorts of the provided view.</td>
</tr>
</table>

### TableGetDataApiKey

Gets data from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>exclude</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the exclude query parameter. If you for example provide the following GET parameter `exclude=field_1,field_2` then the fields with id `1` and id `2` are going to be excluded from the selection and response. If the `user_field_names` parameter is provided then instead exclude should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `exclude=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `exclude=My Field,Field with \"`.</td>
</tr>
<tr>
<td>filterExpression</td><td>A JSON Structure representing the filters in the form :

```
{
	"mode": "AND",  // Can be AND or OR
	"filters": [
		{
			"field": "Name",  	// The name of the column to filter on
			"op": "contains",	// the operation, can be any of the operations described below
			"value": "Little"	// The value of the filter operation
		},
		{
			"field": "Description",
			"op": "contains",
			"value": "1954"
		}
	]
}
```

### operations

|Filter	|Example value	| Full example |
|-------|---------------|--------------|
|equal	|string	|field is 'string'|
|not_equal	|string	|field is not 'string'|
|date_equal	|2020-01-01	|field is date '2020-01-01'|
|date_not_equal	|2020-01-01	|field is not date '2020-01-01'|
|date_equals_today	|	|field is today|
|date_before_today	|	|field is before today|
|date_after_today	|	|field is after today|
|date_equals_days_ago	|Europe/Paris?1	|field is days ago 'Europe/Paris?1'|
|date_equals_months_ago	|Europe/Paris?1	|field is months ago 'Europe/Paris?1'|
|date_equals_years_ago	|Europe/Paris?1	|field is years ago 'Europe/Paris?1'|
|date_equals_week	|	|field in this week|
|date_equals_month	|	|field in this month|
|date_equals_year	|	|field in this year|
|date_equals_day_of_month|	1	|field day of month is '1'|
|date_before	|2020-01-01	|field is before date '2020-01-01'|
|date_after	|2020-01-01	|field is after date '2020-01-01'|
|contains	|string	|field contains 'string'|
|filename_contains|	string|	field filename contains 'string'|
|has_file_type|	image / document	|field has file type 'image / document'|
|contains_not 	string	|field contains not 'string'|
|length_is_lower_than	|5	|field length is lower than '5'|
|higher_than	|100|	field higher than '100'|
|lower_than	|100|	field lower than '100'|
|single_select_equal|	1	|field is '1'|
|single_select_not_equal|	1	|field is not '1'|
|boolean|	true|	field is 'true'|
|link_row_has|	1|	field has '1'|
|link_row_has_not|	1	|field has not '1'|
|link_row_contains|	string	|field contains 'string'|
|link_row_not_contains|	string|	field contains not 'string'|
|multiple_select_has|	1|	field has '1'|
|multiple_select_has_not|	1|	field has not '1'|
|empty|		|field is empty|
|not_empty|		|field is not empty|
</td>
</tr>
<tr>
<td>include_fields</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the include query parameter. If you for example provide the following GET parameter `include=field_1,field_2` then only the fields withid `1` and id `2` are going to be selected and included in the response. If the `user_field_names` parameter is provided then instead include should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `include=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `include=My Field,Field with \"`.</td>
</tr>
<tr>
<td>order_by</td><td>Optionally the rows can be ordered by provided field ids separated by comma. By default a field is ordered in ascending (A-Z) order, but by prepending the field with a '-' it can be ordered descending (Z-A). If the `user_field_names` parameter is provided then instead order_by should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `order_by=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `order_by=My Field,Field with \"`.</td>
</tr>
<tr>
<td>page</td><td>Defines which page of rows should be returned.</td>
</tr>
<tr>
<td>search</td><td>If provided only rows with data that matches the search query are going to be returned.</td>
</tr>
<tr>
<td>size</td><td>Defines how many rows should be returned per page.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
<tr>
<td>view_id</td><td>Includes all the filters and sorts of the provided view.</td>
</tr>
</table>

### TableGetRowByIdApiKey

Gets data from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>row_id</td><td>Returns the row related the provided value.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
</table>

### TableGetViews

List all views for the table related

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>include</td><td>A comma separated list of extra attributes to include on each view in the response. The supported attributes are filters, sortings and decorations. For example include=filters,sortings will add the attributes filters and sortings to every returned view, containing a list of the views filters and sortings respectively.</td>
</tr>
<tr>
<td>limit</td><td>The maximum amount of views that must be returned. This endpoint doesn't support pagination, but if you for example just need to fetch the first view, you can do that by setting a limit. There isn't a limit by default.</td>
</tr>
<tr>
<td>table_id</td><td>Returns only views of the table related to the provided value.</td>
</tr>
<tr>
<td>type</td><td>Optionally filter on the view type. If provided, only views of that type will be returned.</td>
</tr>
</table>

### TableReadRow

Reads a row from a  from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>row_id</td><td>Deletes the row related to the value.</td>
</tr>
<tr>
<td>table_id</td><td>Returns the rows of the table related to the provided value.</td>
</tr>
</table>

### TableUpdateRow

Updates a row in a table 

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>data</td><td></td>
</tr>
<tr>
<td>row_id</td><td>Insert row in this table_id</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TableUpdateRowApiKey

Updates a row in a table ising apikey instead of credentials

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>apikey</td><td></td>
</tr>
<tr>
<td>data</td><td></td>
</tr>
<tr>
<td>row_id</td><td>Insert row in this table_id</td>
</tr>
<tr>
<td>table_id</td><td>Insert row in this table_id</td>
</tr>
</table>

### TokenGetOrRefresh

Gets a token or refresh it if the token is expired the Token will be placed in the current user session

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>email</td><td>The Base row admin email</td>
</tr>
<tr>
<td>password</td><td>The baserow admin password</td>
</tr>
</table>

## Mobile Library

Describes the mobile application global properties

### Shared Actions

#### DisplayTableColumns

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>tableId</td><td></td>
</tr>
</table>

### Shared Components

#### BaseRowGrid

Provides an infinite paginated data Grid that can be fed by data from a BaseRow No Code database. The data grid supports pagination or infinite scroll.

## Setting grid height

By default the height property is set to 'auto'. This means that the grid height will automatically be adjusted to the height of its content. In paginated mode (pagination = true) this will be height of the number of lines in page. You can explicitly set the height a CSS measure unit such a 400px or 300pt. You can set the height to a % of the its container height such as 100%

When using infinite scroll mode (pagination=false) never use height='auto' if the grid is inserted in a scrollable component such as **Content**. If you do so the grid will try to adjust its height with an infinite height and crash. To prevent this set the height to a fixed size in PX or have its container's height constrained.




**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>accessibility</td><td>boolean: true (default) or false</td>
</tr>
<tr>
<td>ariaLabel</td><td></td>
</tr>
<tr>
<td>autoSizeColumns</td><td>If true, columns will sized to fit their content</td>
</tr>
<tr>
<td>dataSource</td><td>The BaseRow CRUD "List" sequence name imported from the NoCode View. For example :
<pre>MyProject.Hotel_BookingsRoomsList</pre>
<pre>.Hotel_BookingsRoomsList</pre>
Where *MyProject* is the name of the project holding the Sequence and *Hotel_BookingsRoomsList* is the name of the Sequence in this project.


</td>
</tr>
<tr>
<td>defaultColDef</td><td>default is {hide: false, editable: true, sortable: true, resizable: true, filter: true, checkboxSelection: false, singleClickEdit: false}</td>
</tr>
<tr>
<td>filters</td><td>An JSON object containing the filter to apply to a BaseRow filtered view where each filter is the exact name of the filter variable attached to a filtered list sequence :

<pre>
{
	filter&lt;And/Or&gt;&lt;Column Name 1&gt;&lt;Op&gt;: &lt;filter to apply N° 1&gt;,
	filter&lt;And/Or&gt;&lt;Column Name 2&gt;&lt;Op&gt;: &lt;filter to apply N° 2&gt;
}
</pre>

for example for Sequence GTFSPlacesSmallAirportsList :

NB: Be sure to use simple quotes in your JSON structure for strings

<pre>

{
	filterAndTypeContains: 'small_airport',
	filterAndIso_countryEqual: 'FR'
}
</pre>


Will fill the grid with all records where column *Type* *Contains* to *small_airports* and column *Type* *Contains* to *Iso_countryEqual* equals *FR*. Filter names will be imported from the No Code Database view.



</td>
</tr>
<tr>
<td>height</td><td>height is 'auto' or value in % or px</td>
</tr>
<tr>
<td>id</td><td>An Optional ID</td>
</tr>
<tr>
<td>overlayLoadingTemplate</td><td></td>
</tr>
<tr>
<td>overlayNoRowsTemplate</td><td></td>
</tr>
<tr>
<td>pagination</td><td>true : paginate, false : infinitescroll (Warning! do not use height='auto' in this case)</td>
</tr>
<tr>
<td>paginationPageSize</td><td>integer: 10 by default</td>
</tr>
<tr>
<td>rowDeselection</td><td>boolean: true (default) or false</td>
</tr>
<tr>
<td>rowHeight</td><td>Height of the row in pixels as a string</td>
</tr>
<tr>
<td>rowSelection</td><td>string: 'single' (default) or 'multiple'</td>
</tr>
<tr>
<td>search</td><td>Will only return data that matches this search whatever the column is. This is a dynamic variable meaning that if modified bounded to search field for example each time the search changes the grid will be refreshed with the new search.

</td>
</tr>
<tr>
<td>suppressCellSelection</td><td>Enables or not cell selection</td>
</tr>
<tr>
<td>suppressRowClickSelection</td><td>Enables or not row selection</td>
</tr>
<tr>
<td>width</td><td>width value in % or px</td>
</tr>
<tr>
<td>wrapperClass</td><td>A class name for the grid container</td>
</tr>
</table>



