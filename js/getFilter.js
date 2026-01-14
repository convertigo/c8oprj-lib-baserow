// 1.29.3 baserow filters (see internal_documentation.md to re-generate filters)
var _c8oBRtypes = {
  "field_types": {
    "autonumber": [
      "contains",
      "contains_not",
      "equal",
      "higher_than",
      "higher_than_or_equal",
      "is_even_and_whole",
      "lower_than",
      "lower_than_or_equal",
      "not_equal"
    ],
    "boolean": [
      "boolean",
      "empty",
      "not_empty"
    ],
    "created_by": [
      "user_is",
      "user_is_not"
    ],
    "created_on": [
      "contains",
      "contains_not",
      "date_after",
      "date_after_days_ago",
      "date_after_or_equal",
      "date_after_today",
      "date_before",
      "date_before_or_equal",
      "date_before_today",
      "date_equal",
      "date_equals_day_of_month",
      "date_equals_days_ago",
      "date_equals_month",
      "date_equals_months_ago",
      "date_equals_today",
      "date_equals_week",
      "date_equals_year",
      "date_equals_years_ago",
      "date_is",
      "date_is_after",
      "date_is_before",
      "date_is_not",
      "date_is_on_or_after",
      "date_is_on_or_before",
      "date_is_within",
      "date_not_equal",
      "date_within_days",
      "date_within_months",
      "date_within_weeks",
      "empty",
      "not_empty"
    ],
    "date": [
      "contains",
      "contains_not",
      "date_after",
      "date_after_days_ago",
      "date_after_or_equal",
      "date_after_today",
      "date_before",
      "date_before_or_equal",
      "date_before_today",
      "date_equal",
      "date_equals_day_of_month",
      "date_equals_days_ago",
      "date_equals_month",
      "date_equals_months_ago",
      "date_equals_today",
      "date_equals_week",
      "date_equals_year",
      "date_equals_years_ago",
      "date_is",
      "date_is_after",
      "date_is_before",
      "date_is_not",
      "date_is_on_or_after",
      "date_is_on_or_before",
      "date_is_within",
      "date_not_equal",
      "date_within_days",
      "date_within_months",
      "date_within_weeks",
      "empty",
      "not_empty"
    ],
    "duration": [
      "empty",
      "equal",
      "higher_than",
      "higher_than_or_equal",
      "lower_than",
      "lower_than_or_equal",
      "not_empty",
      "not_equal"
    ],
    "email": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ],
    "file": [
      "empty",
      "filename_contains",
      "files_lower_than",
      "has_file_type",
      "not_empty"
    ],
    "last_modified": [
      "contains",
      "contains_not",
      "date_after",
      "date_after_days_ago",
      "date_after_or_equal",
      "date_after_today",
      "date_before",
      "date_before_or_equal",
      "date_before_today",
      "date_equal",
      "date_equals_day_of_month",
      "date_equals_days_ago",
      "date_equals_month",
      "date_equals_months_ago",
      "date_equals_today",
      "date_equals_week",
      "date_equals_year",
      "date_equals_years_ago",
      "date_is",
      "date_is_after",
      "date_is_before",
      "date_is_not",
      "date_is_on_or_after",
      "date_is_on_or_before",
      "date_is_within",
      "date_not_equal",
      "date_within_days",
      "date_within_months",
      "date_within_weeks",
      "empty",
      "not_empty"
    ],
    "last_modified_by": [
      "user_is",
      "user_is_not"
    ],
    "link_row": [
      "empty",
      "link_row_contains",
      "link_row_has",
      "link_row_has_not",
      "link_row_not_contains",
      "not_empty"
    ],
    "long_text": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ],
    "multiple_collaborators": [
      "empty",
      "multiple_collaborators_has",
      "multiple_collaborators_has_not",
      "not_empty"
    ],
    "multiple_select": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "multiple_select_has",
      "multiple_select_has_not",
      "not_empty"
    ],
    "number": [
      "contains",
      "contains_not",
      "empty",
      "equal",
      "higher_than",
      "higher_than_or_equal",
      "is_even_and_whole",
      "lower_than",
      "lower_than_or_equal",
      "not_empty",
      "not_equal"
    ],
    "password": [
      "empty",
      "not_empty"
    ],
    "phone_number": [
      "contains",
      "contains_not",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ],
    "rating": [
      "equal",
      "higher_than",
      "higher_than_or_equal",
      "lower_than",
      "lower_than_or_equal",
      "not_equal"
    ],
    "single_select": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "not_empty",
      "single_select_equal",
      "single_select_is_any_of",
      "single_select_is_none_of",
      "single_select_not_equal"
    ],
    "text": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ],
    "url": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ],
    "uuid": [
      "equal",
      "not_equal"
    ]
  },
  "formula_types": {
    "array(boolean)": [
      "empty",
      "has_all_values_equal",
      "has_not_value_equal",
      "has_value_equal",
      "not_empty"
    ],
    "array(char)": [
      "has_empty_value",
      "has_not_empty_value",
      "has_not_value_contains",
      "has_not_value_contains_word",
      "has_not_value_equal",
      "has_value_contains",
      "has_value_contains_word",
      "has_value_equal",
      "has_value_length_is_lower_than"
    ],
    "array(single_file)": [
      "empty",
      "filename_contains",
      "has_file_type",
      "not_empty"
    ],
    "array(single_select)": [
      "has_any_select_option_equal",
      "has_empty_value",
      "has_none_select_option_equal",
      "has_not_empty_value",
      "has_not_value_contains",
      "has_not_value_contains_word",
      "has_not_value_equal",
      "has_value_contains",
      "has_value_contains_word",
      "has_value_equal"
    ],
    "array(text)": [
      "has_empty_value",
      "has_not_empty_value",
      "has_not_value_contains",
      "has_not_value_contains_word",
      "has_not_value_equal",
      "has_value_contains",
      "has_value_contains_word",
      "has_value_equal",
      "has_value_length_is_lower_than"
    ],
    "array(url)": [
      "has_empty_value",
      "has_not_empty_value",
      "has_not_value_contains",
      "has_not_value_contains_word",
      "has_not_value_equal",
      "has_value_contains",
      "has_value_contains_word",
      "has_value_equal",
      "has_value_length_is_lower_than"
    ],
    "boolean": [
      "boolean",
      "empty",
      "not_empty"
    ],
    "char": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "not_empty",
      "not_equal"
    ],
    "date": [
      "contains",
      "contains_not",
      "date_after",
      "date_after_days_ago",
      "date_after_or_equal",
      "date_after_today",
      "date_before",
      "date_before_or_equal",
      "date_before_today",
      "date_equal",
      "date_equals_days_ago",
      "date_equals_month",
      "date_equals_months_ago",
      "date_equals_today",
      "date_equals_week",
      "date_equals_year",
      "date_equals_years_ago",
      "date_is",
      "date_is_after",
      "date_is_before",
      "date_is_not",
      "date_is_on_or_after",
      "date_is_on_or_before",
      "date_is_within",
      "date_not_equal",
      "date_within_days",
      "date_within_months",
      "date_within_weeks",
      "empty",
      "not_empty"
    ],
    "number": [
      "contains",
      "contains_not",
      "empty",
      "equal",
      "higher_than",
      "higher_than_or_equal",
      "is_even_and_whole",
      "lower_than",
      "lower_than_or_equal",
      "not_empty",
      "not_equal"
    ],
    "single_select": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "not_empty",
      "single_select_equal",
      "single_select_is_any_of",
      "single_select_is_none_of",
      "single_select_not_equal"
    ],
    "text": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "not_empty",
      "not_equal"
    ],
    "url": [
      "contains",
      "contains_not",
      "contains_word",
      "doesnt_contain_word",
      "empty",
      "equal",
      "length_is_lower_than",
      "not_empty",
      "not_equal"
    ]
  }
}


var FORMULA_FIELD_TYPES = ['formula', 'count', 'rollup', 'lookup'];
var getBrFilterType = (elem)=>{
	if(FORMULA_FIELD_TYPES.indexOf(elem.type) != -1 ){
		if(elem.formula_type == "array"){
			let str = "array(" + elem.array_formula_type +")";
			return { type: elem.array_formula_type, isArray: true, key: "formula_types."+str, value: _c8oBRtypes["formula_types"][str] };
		}
		else{
			return { type: elem.formula_type, isArray: false, key: "formula_types."+elem.formula_type, value: _c8oBRtypes["formula_types"][elem.formula_type] };
		}
	}
	else{
		return { type: elem.type, isArray: false, key: "field_types."+elem.type, value: _c8oBRtypes["field_types"][elem.type] };
	}
}