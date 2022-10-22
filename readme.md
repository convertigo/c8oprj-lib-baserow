


# lib_BaseRow

This is the Baserow connector for Convertigo


For more technical informations : [documentation](./project.md)

- [Installation](#installation)
- [Sequences](#sequences)
    - [AdminLogin](#adminlogin)
    - [ApplicationsList](#applicationslist)
    - [FieldsList](#fieldslist)
    - [formssource_GetSelectData](#formssource_getselectdata)
    - [formssource_GetTableData](#formssource_gettabledata)
    - [GroupsList](#groupslist)
    - [TableGetData](#tablegetdata)
- [Mobile Library](#mobile-library)


## Installation

1. In your Convertigo Studio use `File->Import->Convertigo->Convertigo Project` and hit the `Next` button
2. In the dialog `Project remote URL` field, paste the text below:
   <table>
     <tr><td>Usage</td><td>Click the copy button</td></tr>
     <tr><td>To contribute</td><td>

     ```
     lib_BaseRow=https://github.com/convertigo/c8oprj-lib-baserow.git:branch=master
     ```
     </td></tr>
     <tr><td>To simply use</td><td>

     ```
     lib_BaseRow=https://github.com/convertigo/c8oprj-lib-baserow/archive/master.zip
     ```
     </td></tr>
    </table>
3. Click the `Finish` button. This will automatically import the __lib_BaseRow__ project


## Sequences

### AdminLogin

Establishes a session with Baserow. Must be called befor any other API

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

### ApplicationsList

Lists all applications (databases) in baserow

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>group_id</td><td>Returns only applications that are in the group related to the provided value.</td>
</tr>
</table>

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

### formssource_GetSelectData

Gets data from a baserow table.


**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_columns</td><td>The comma separated list of columns. The first on represents the select display , the second the select value
</td>
</tr>
<tr>
<td>forms_filter</td><td>Filters
</td>
</tr>
<tr>
<td>forms_table_id</td><td>Fills the select from the data coming from this table id
</td>
</tr>
<tr>
<td>forms_view_id</td><td>The optional View ID associated to this table
</td>
</tr>
</table>

### formssource_GetTableData

Gets data from a baserow table.


**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>forms_config</td><td>Returns the rows of the table related to the provided value</td>
</tr>
<tr>
<td>forms_filter</td><td>Filters
</td>
</tr>
</table>

### GroupsList

Lists all Groups for the current user

### TableGetData

Gets data from a given table

**variables**

<table>
<tr>
<th>name</th><th>comment</th>
</tr>
<tr>
<td>exclude</td><td>All the fields are included in the response by default. You can select a subset of fields by providing the exclude query parameter. If you for example provide the following GET parameter `exclude=field_1,field_2` then the fields with id `1` and id `2` are going to be excluded from the selection and response. If the `user_field_names` parameter is provided then instead exclude should be a comma separated list of the actual field names. For field names with commas you should surround the name with quotes like so: `exclude=My Field,"Field With , "`. A backslash can be used to escape field names which contain double quotes like so: `exclude=My Field,Field with \"`.</td>
</tr>
<tr>
<td>filter</td><td>The rows can optionally be filtered by the same view filters available for the views. Multiple filters can be provided if they follow the same format. The field and filter variable indicate how to filter and the value indicates where to filter on.

For example if you provide the following GET parameter `filter__field_1__equal=test` then only rows where the value of field_1 is equal to test are going to be returned.

The following filters are available: equal, not_equal, filename_contains, has_file_type, contains, contains_not, length_is_lower_than, higher_than, lower_than, date_equal, date_before, date_after, date_not_equal, date_equals_today, date_before_today, date_after_today, date_equals_days_ago, date_equals_months_ago, date_equals_years_ago, date_equals_week, date_equals_month, date_equals_day_of_month, date_equals_year, single_select_equal, single_select_not_equal, link_row_has, link_row_has_not, link_row_contains, link_row_not_contains, boolean, empty, not_empty, multiple_select_has, multiple_select_has_not.</td>
</tr>
<tr>
<td>filter_type</td><td>`AND`: Indicates that the rows must match all the provided filters.
`OR`: Indicates that the rows only have to match one of the filters.

This works only if two or more filters are provided.</td>
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

## Mobile Library

Describes the mobile application global properties



